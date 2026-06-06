// ─────────────────────────────────────────────────────────────────────────────
// auth.service.js
//
// The service layer for all authentication logic.
// Controllers stay thin by delegating every real operation here.
// This file owns: token creation, credential verification, token rotation,
// logout invalidation, and password changes.
// It never touches req/res — it only works with plain data and throws ApiErrors.
// ─────────────────────────────────────────────────────────────────────────────

const jwt              = require("jsonwebtoken");
const LibraryAttendant = require("../models/LibraryAttendant");
const ApiError         = require("../utils/ApiError");

const {
  JWT_SECRET,             // Secret key used to sign/verify short-lived access tokens
  JWT_EXPIRES_IN,         // e.g. "15m" — how long an access token stays valid
  JWT_REFRESH_SECRET,     // Separate secret for refresh tokens — different key = tighter scope
  JWT_REFRESH_EXPIRES_IN, // e.g. "7d" — how long a refresh token stays valid
} = require("../config/env");


// ─── Token Helpers ────────────────────────────────────────────────────────────
// Private functions — not exported — used only inside this module.

/**
 * signAccessToken
 * Creates a short-lived JWT the client attaches to every protected API request.
 * Payload is minimal (just the attendant's DB id) to keep the token small.
 */
const signAccessToken = (id) =>
  jwt.sign(
    { id },                          // Payload: only the attendant's MongoDB ObjectId
    JWT_SECRET,                      // Signed with the access-token-specific secret
    { expiresIn: JWT_EXPIRES_IN }    // Token self-expires; no DB lookup needed to detect expiry
  );

/**
 * signRefreshToken
 * Creates a long-lived JWT stored in the DB so it can be explicitly revoked.
 * Uses a different secret from access tokens so a compromised access secret
 * cannot be used to forge refresh tokens (and vice versa).
 */
const signRefreshToken = (id) =>
  jwt.sign(
    { id },                                   // Same minimal payload
    JWT_REFRESH_SECRET,                       // Different secret from access token for isolation
    { expiresIn: JWT_REFRESH_EXPIRES_IN }     // Long window (days) so users aren't forced to re-login often
  );


// ─── login ────────────────────────────────────────────────────────────────────
const login = async (email, password) => {

  // Query the DB for a document matching the supplied email.
  // .select("+password") is required because the schema marks `password` as
  // select:false — excluded from all queries by default for safety.
  const attendant = await LibraryAttendant
    .findOne({ email })
    .select("+password");

  // Security: use a single generic error message whether the email is unknown
  // OR the password is wrong — prevents email enumeration attacks.
  if (!attendant || !(await attendant.comparePassword(password))) {
    throw new ApiError(401, "Invalid credentials.");
  }

  // Secondary guard: a deactivated attendant can still pass the password check above
  if (!attendant.isActive) {
    throw new ApiError(401, "Your account has been deactivated. Contact an admin.");
  }

  // Record the exact moment this successful login occurred.
  // Set BEFORE .save() so the timestamp is written in the same DB call as the refresh token.
  attendant.lastLoginAt = new Date();

  // Generate a fresh token pair for this session
  const accessToken  = signAccessToken(attendant._id);
  const refreshToken = signRefreshToken(attendant._id);

  // Persist the refresh token in the DB so logout can explicitly revoke it
  attendant.refreshToken = refreshToken;

  // validateBeforeSave: false — only updating refreshToken and lastLoginAt,
  // so we skip re-running all Mongoose validators (faster, avoids spurious errors)
  await attendant.save({ validateBeforeSave: false });

  // Strip sensitive fields (password hash, raw refreshToken) before returning
  return { attendant: attendant.toSafeObject(), accessToken, refreshToken };
};


// ─── refresh ──────────────────────────────────────────────────────────────────
const refresh = async (incomingToken) => {

  let decoded;

  try {
    // jwt.verify() checks signature AND expiry simultaneously.
    // Throws TokenExpiredError or JsonWebTokenError on failure.
    decoded = jwt.verify(incomingToken, JWT_REFRESH_SECRET);
  } catch {
    throw new ApiError(401, "Invalid or expired refresh token. Please log in again.");
  }

  // Token signature was valid — now check the DB to see if it was revoked.
  // .select("+refreshToken") opts in to the field excluded by default.
  const attendant = await LibraryAttendant
    .findById(decoded.id)
    .select("+refreshToken");

  // Two failure modes:
  //   • Account deleted after token was issued
  //   • Stored token doesn't match — already rotated or nulled by logout
  if (!attendant || attendant.refreshToken !== incomingToken) {
    throw new ApiError(401, "Refresh token has been revoked. Please log in again.");
  }

  // Token rotation: generate a completely new pair and invalidate the old refresh token.
  // If a refresh token is stolen, it can only be used once before the legitimate
  // user's next refresh overwrites it — the attacker's copy becomes useless immediately.
  const accessToken  = signAccessToken(attendant._id);
  const refreshToken = signRefreshToken(attendant._id);

  attendant.refreshToken = refreshToken; // Old token is now dead
  await attendant.save({ validateBeforeSave: false });

  return { accessToken, refreshToken };
};


// ─── logout ───────────────────────────────────────────────────────────────────
const logout = async (attendantId) => {

  // One targeted update — no need to load the full document into memory.
  // Setting refreshToken to null means any future refresh() call will fail
  // the `attendant.refreshToken !== incomingToken` check and be rejected.
  // The access token still lives until natural expiry (e.g. 15 min) —
  // an accepted trade-off with stateless JWTs. The passwordChangedAt check
  // in protect middleware handles the rare case where this matters.
  await LibraryAttendant.findByIdAndUpdate(
    attendantId,
    { refreshToken: null } // Revoke server-side — client should also discard both tokens
  );
};


// ─── changePassword ───────────────────────────────────────────────────────────
const changePassword = async (attendantId, currentPassword, newPassword) => {

  // Fetch with password field included (excluded by default via select:false)
  const attendant = await LibraryAttendant
    .findById(attendantId)
    .select("+password");

  // Verify they actually know the current password before allowing a change.
  // Prevents a stolen access token from being used to lock out the real owner.
  if (!(await attendant.comparePassword(currentPassword))) {
    throw new ApiError(400, "Current password is incorrect.");
  }

  // Assign the new plain-text password — the model's pre('save') hook will
  // intercept this and run bcrypt.hash() before writing to the DB.
  attendant.password = newPassword;

  // ── FIX: Record when the password was changed ──────────────────────────
  // This timestamp is checked by protect middleware (auth.middleware.js Step 5).
  // Any access token issued BEFORE this timestamp will be rejected, effectively
  // invalidating all active sessions the moment the password is changed.
  // This closes the window where a stolen token stays valid post-password-change.
  attendant.passwordChangedAt = new Date();

  // ── FIX: Clear the stored refresh token ───────────────────────────────
  // Forces the user to log in again with the new password to get fresh tokens.
  // Any existing refresh token is now dead — replaying it will fail in refresh().
  attendant.refreshToken = null;

  // .save() (without validateBeforeSave:false) triggers the hashing middleware.
  // Full validation is intentional — new password may have length/complexity rules.
  await attendant.save();
};


module.exports = { login, refresh, logout, changePassword };