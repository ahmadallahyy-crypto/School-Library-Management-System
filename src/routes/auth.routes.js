const express        = require("express");
const router         = express.Router();
const authController = require("../controllers/auth.controller");
const { protect }    = require("../middleware/auth.middleware");
const { validate }   = require("../middleware/validate.middleware");
const { authLimiter } = require("../middleware/rateLimit.middleware");
const v              = require("../validators/auth.validator");
const attendantV     = require("../validators/attendant.validator");


// ── Public routes (no token required) ─────────────────────────────────────────

// One-time setup — self-disables once any attendant exists
router.post("/setup",           authLimiter, validate(attendantV.createAttendant), authController.setup);
router.post("/login",           authLimiter, validate(v.login),         authController.login);
router.post("/refresh",         authLimiter, validate(v.refreshToken),  authController.refresh);

// ── Protected routes (valid JWT required) ─────────────────────────────────────

router.post("/logout",          protect, authController.logout);
router.get( "/me",              protect, authController.getMe);
router.put( "/change-password", protect, validate(v.changePassword), authController.changePassword);


// ADD THESE TWO ROUTES to your existing auth.routes.js
// Place them in the public routes section (no protect middleware needed)

router.post("/send-otp",   authLimiter, authController.sendOtp);   // Step 1: verify credentials → send OTP
router.post("/verify-otp", authLimiter, authController.verifyOtp); // Step 2: verify OTP → issue tokens

module.exports = router;
