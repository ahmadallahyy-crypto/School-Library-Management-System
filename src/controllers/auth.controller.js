// ─────────────────────────────────────────────────────────────────────────────
// auth.controller.js
// ─────────────────────────────────────────────────────────────────────────────

const LibraryAttendant = require("../models/LibraryAttendant");
const authService      = require("../services/auth.service");
const ApiResponse      = require("../utils/ApiResponse");
const ApiError         = require("../utils/ApiError");
const pick             = require("../utils/pick");


// ─── POST /api/auth/setup ─────────────────────────────────────────────────────
exports.setup = async (req, res, next) => {
  try {
    const count = await LibraryAttendant.countDocuments();

    if (count > 0) {
      return next(new ApiError(403, "System already set up. Use /api/auth/login to access the system."));
    }

    const safeData  = pick(req.body, ["name", "email", "password", "staffId", "shift"]);
    const attendant = await LibraryAttendant.create({ ...safeData, role: "admin" });

    const { accessToken, refreshToken } = await authService.login(
      attendant.email,
      req.body.password
    );

    const freshAttendant = await LibraryAttendant.findById(attendant._id);

    res.status(201).json(
      new ApiResponse(201, {
        attendant: freshAttendant.toSafeObject(),
        accessToken,
        refreshToken,
      }, "First admin account created. You are now logged in.")
    );
  } catch (err) { next(err); }
};


// ─── POST /api/auth/login ─────────────────────────────────────────────────────
exports.login = async (req, res, next) => {
  try {
    const { attendant, accessToken, refreshToken } = await authService.login(
      req.body.email,
      req.body.password
    );

    res.status(200).json(
      new ApiResponse(200, { attendant, accessToken, refreshToken }, "Logged in successfully.")
    );
  } catch (err) { next(err); }
};


// ─── POST /api/auth/refresh ───────────────────────────────────────────────────
exports.refresh = async (req, res, next) => {
  try {
    const tokens = await authService.refresh(req.body.refreshToken);
    res.status(200).json(new ApiResponse(200, tokens, "Token refreshed successfully."));
  } catch (err) { next(err); }
};


// ─── POST /api/auth/logout ────────────────────────────────────────────────────
exports.logout = async (req, res, next) => {
  try {
    await authService.logout(req.attendant._id);
    res.status(200).json(new ApiResponse(200, null, "Logged out successfully."));
  } catch (err) { next(err); }
};


// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
exports.getMe = async (req, res, next) => {
  try {
    res.status(200).json(new ApiResponse(200, req.attendant.toSafeObject(), "Profile fetched."));
  } catch (err) { next(err); }
};


// ─── PUT /api/auth/change-password ───────────────────────────────────────────
exports.changePassword = async (req, res, next) => {
  try {
    await authService.changePassword(
      req.attendant._id,
      req.body.currentPassword,
      req.body.newPassword
    );
    res.status(200).json(new ApiResponse(200, null, "Password changed successfully."));
  } catch (err) { next(err); }
};


// ─── POST /api/auth/send-otp ──────────────────────────────────────────────────
// Step 1 of 2FA login — verify credentials then send OTP to email
exports.sendOtp = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const result = await authService.sendOtp(email, password);
    res.status(200).json(new ApiResponse(200, result, "Verification code sent to your email."));
  } catch (err) { next(err); }
};


// ─── POST /api/auth/verify-otp ───────────────────────────────────────────────
// Step 2 of 2FA login — verify OTP and issue tokens
exports.verifyOtp = async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    const { attendant, accessToken, refreshToken } = await authService.verifyOtp(email, otp);
    res.status(200).json(
      new ApiResponse(200, { attendant, accessToken, refreshToken }, "Logged in successfully.")
    );
  } catch (err) { next(err); }
};