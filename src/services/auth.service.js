// ─────────────────────────────────────────────────────────────────────────────
// auth.service.js
// ─────────────────────────────────────────────────────────────────────────────

const jwt              = require("jsonwebtoken");
const bcrypt           = require("bcryptjs");
const LibraryAttendant = require("../models/LibraryAttendant");
const Otp              = require("../models/Otp");
const ApiError         = require("../utils/ApiError");
const { sendOtpEmail } = require("./email.service");

const {
  JWT_SECRET,
  JWT_EXPIRES_IN,
  JWT_REFRESH_SECRET,
  JWT_REFRESH_EXPIRES_IN,
} = require("../config/env");


// ─── Token Helpers ────────────────────────────────────────────────────────────

const signAccessToken = (id) =>
  jwt.sign({ id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

const signRefreshToken = (id) =>
  jwt.sign({ id }, JWT_REFRESH_SECRET, { expiresIn: JWT_REFRESH_EXPIRES_IN });


// ─── login ────────────────────────────────────────────────────────────────────
const login = async (email, password) => {

  const attendant = await LibraryAttendant
    .findOne({ email })
    .select("+password");

  if (!attendant || !(await attendant.comparePassword(password))) {
    throw new ApiError(401, "Invalid credentials.");
  }

  if (!attendant.isActive) {
    throw new ApiError(401, "Your account has been deactivated. Contact an admin.");
  }

  attendant.lastLoginAt  = new Date();
  const accessToken      = signAccessToken(attendant._id);
  const refreshToken     = signRefreshToken(attendant._id);
  attendant.refreshToken = refreshToken;
  await attendant.save({ validateBeforeSave: false });

  return { attendant: attendant.toSafeObject(), accessToken, refreshToken };
};


// ─── refresh ──────────────────────────────────────────────────────────────────
const refresh = async (incomingToken) => {

  let decoded;
  try {
    decoded = jwt.verify(incomingToken, JWT_REFRESH_SECRET);
  } catch {
    throw new ApiError(401, "Invalid or expired refresh token. Please log in again.");
  }

  const attendant = await LibraryAttendant
    .findById(decoded.id)
    .select("+refreshToken");

  if (!attendant || attendant.refreshToken !== incomingToken) {
    throw new ApiError(401, "Refresh token has been revoked. Please log in again.");
  }

  const accessToken      = signAccessToken(attendant._id);
  const refreshToken     = signRefreshToken(attendant._id);
  attendant.refreshToken = refreshToken;
  await attendant.save({ validateBeforeSave: false });

  return { accessToken, refreshToken };
};


// ─── logout ───────────────────────────────────────────────────────────────────
const logout = async (attendantId) => {
  await LibraryAttendant.findByIdAndUpdate(attendantId, { refreshToken: null });
};


// ─── changePassword ───────────────────────────────────────────────────────────
const changePassword = async (attendantId, currentPassword, newPassword) => {

  const attendant = await LibraryAttendant
    .findById(attendantId)
    .select("+password");

  if (!(await attendant.comparePassword(currentPassword))) {
    throw new ApiError(400, "Current password is incorrect.");
  }

  attendant.password          = newPassword;
  attendant.passwordChangedAt = new Date();
  attendant.refreshToken      = null;
  await attendant.save();
};


// ─── sendOtp ──────────────────────────────────────────────────────────────────
// Step 1 of 2FA — verify credentials then generate and email a 6-digit OTP
const sendOtp = async (email, password) => {

  // Verify credentials first
  const attendant = await LibraryAttendant
    .findOne({ email })
    .select("+password");

  if (!attendant || !(await attendant.comparePassword(password))) {
    throw new ApiError(401, "Invalid credentials.");
  }

  if (!attendant.isActive) {
    throw new ApiError(401, "Your account has been deactivated. Contact an admin.");
  }

  // Generate random 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  // Hash before saving — never store plain OTP in DB
  const hashedOtp = await bcrypt.hash(otp, 10);

  // Delete any existing OTP for this email — only one active at a time
  await Otp.deleteMany({ email });

  // Save hashed OTP with 10-minute expiry
  await Otp.create({
    email,
    otp:       hashedOtp,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });

  // Send plain OTP to user's email
  await sendOtpEmail(email, otp, attendant.name);

  // Return email so frontend can pre-fill the verify screen
  return { email };
};


// ─── verifyOtp ────────────────────────────────────────────────────────────────
// Step 2 of 2FA — verify OTP then issue tokens
const verifyOtp = async (email, otp) => {

  const otpDoc = await Otp.findOne({ email });

  if (!otpDoc) {
    throw new ApiError(400, "No OTP found for this email. Please log in again.");
  }

  // Check expiry
  if (otpDoc.expiresAt < new Date()) {
    await Otp.deleteOne({ email });
    throw new ApiError(400, "OTP has expired. Please log in again.");
  }

  // Compare submitted OTP with hash
  const isMatch = await bcrypt.compare(otp, otpDoc.otp);
  if (!isMatch) {
    throw new ApiError(400, "Invalid OTP. Please check your email and try again.");
  }

  // Delete immediately — single use only
  await Otp.deleteOne({ email });

  // Issue tokens
  const attendant        = await LibraryAttendant.findOne({ email });
  attendant.lastLoginAt  = new Date();
  const accessToken      = signAccessToken(attendant._id);
  const refreshToken     = signRefreshToken(attendant._id);
  attendant.refreshToken = refreshToken;
  await attendant.save({ validateBeforeSave: false });

  return { attendant: attendant.toSafeObject(), accessToken, refreshToken };
};


module.exports = { login, refresh, logout, changePassword, sendOtp, verifyOtp };