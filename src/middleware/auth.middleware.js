// ─────────────────────────────────────────────────────────────────────────────
// auth.middleware.js
//
// Two middleware functions exported from this file:
//
//   protect   — verifies the JWT, loads the attendant, and blocks inactive accounts.
//               Also rejects tokens issued before the last password change.
//
//   authorize — role guard. Call after protect to restrict a route to specific roles.
//               Usage: router.delete("/x", protect, authorize("admin"), handler)
//
// Request flow:
//   Request → protect → authorize (optional) → Controller
//                 ↓
//            ❌ fails? → 401 / 403 error
//            ✅ passes? → next()
// ─────────────────────────────────────────────────────────────────────────────

const jwt              = require("jsonwebtoken");
const LibraryAttendant = require("../models/LibraryAttendant");
const ApiError         = require("../utils/ApiError");
const { JWT_SECRET }   = require("../config/env");


// ─────────────────────────────────────────────────────────────────────────────
// protect
// Runs on every route that requires a valid login session.
// ─────────────────────────────────────────────────────────────────────────────
const protect = async (req, res, next) => {
  try {
    let token;

    // ── Step 1: Extract token ──────────────────────────────────────────────
    // The client sends: Authorization: Bearer <token>
    // split(" ")[1] grabs only the token string, discarding the "Bearer" prefix
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer ")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    // ── Step 2: Reject if no token ─────────────────────────────────────────
    if (!token) {
      return next(new ApiError(401, "Access denied. No token provided."));
    }

    // ── Step 3: Verify signature and expiry ───────────────────────────────
    // jwt.verify() throws specific named errors we catch below:
    //   TokenExpiredError  — token is structurally valid but exp timestamp has passed
    //   JsonWebTokenError  — malformed token, wrong secret, or tampered payload
    // We handle these explicitly so the client gets a clear, actionable message
    // instead of a generic 500 from the global error handler.
    let decoded; // Will hold { id, iat, exp } on success
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (jwtErr) {
      if (jwtErr.name === "TokenExpiredError") {
        // Token was valid but its lifetime has ended — prompt re-login or refresh
        return next(new ApiError(401, "Token expired. Please log in again."));
      }
      if (jwtErr.name === "JsonWebTokenError") {
        // Token was tampered with, malformed, or signed with a different secret
        return next(new ApiError(401, "Invalid token. Please log in again."));
      }
      // Any other JWT-related error (rare) — still a 401
      return next(new ApiError(401, "Authentication failed. Please log in again."));
    }

    // ── Step 4: Load attendant from DB ────────────────────────────────────
    // A valid token signature does NOT mean the account still exists.
    // Someone could delete an account; the token would still pass Step 3.
    // We also select passwordChangedAt to run the stale-token check below.
    const attendant = await LibraryAttendant
      .findById(decoded.id)
      .select("+passwordChangedAt"); // opt-in to a field excluded from queries by default

    if (!attendant) {
      return next(new ApiError(401, "Account no longer exists."));
    }

    if (!attendant.isActive) {
      return next(new ApiError(401, "Account deactivated. Contact admin."));
    }

    // ── Step 5: Reject tokens issued before the last password change ──────
    // Scenario: attacker steals an access token. The real user changes their
    // password to kick out the attacker. Without this check, the stolen token
    // would still work until it naturally expired (up to 15 min).
    //
    // passwordChangedAt is set by authService.changePassword() after every
    // successful password update. If it exists and the token was signed BEFORE
    // that timestamp, we reject it — the user must log in again with the new password.
    //
    // decoded.iat is in UNIX seconds; passwordChangedAt is a JS Date (milliseconds).
    // We convert passwordChangedAt to seconds for a consistent comparison.
    if (attendant.passwordChangedAt) {
      const passwordChangedAtSeconds = Math.floor(
        attendant.passwordChangedAt.getTime() / 1000
      );

      if (decoded.iat < passwordChangedAtSeconds) {
        // Token was signed before the password was changed — treat it as revoked
        return next(new ApiError(401, "Password was recently changed. Please log in again."));
      }
    }

    // ── Step 6: Attach attendant to request ───────────────────────────────
    // Controllers and subsequent middleware access the logged-in user via:
    //   req.attendant._id   — MongoDB ObjectId
    //   req.attendant.role  — "admin" | "attendant" (used by authorize below)
    req.attendant = attendant;
    next();

  } catch (err) {
    next(err);
  }
};


// ─────────────────────────────────────────────────────────────────────────────
// authorize
// Role-based access control. Must be used AFTER protect (needs req.attendant).
//
// Usage examples:
//   router.post("/",      protect, authorize("admin"),              handler) // admin only
//   router.get("/",       protect, authorize("admin", "attendant"), handler) // both roles
//   router.delete("/:id", protect, authorize("admin"),              handler) // admin only
//
// How it works:
//   authorize("admin") returns a middleware function.
//   That function checks if req.attendant.role is in the allowed list.
//   If not → 403 Forbidden. If yes → next().
// ─────────────────────────────────────────────────────────────────────────────
const authorize = (...roles) => {
  // roles is a rest parameter — authorize("admin", "attendant") → roles = ["admin", "attendant"]
  return (req, res, next) => {
    if (!roles.includes(req.attendant.role)) {
      // 403 Forbidden (not 401) — the user IS authenticated, just not authorised
      return next(
        new ApiError(
          403,
          `Access denied. Required role: ${roles.join(" or ")}. Your role: ${req.attendant.role}.`
        )
      );
    }
    next();
  };
};


module.exports = { protect, authorize };