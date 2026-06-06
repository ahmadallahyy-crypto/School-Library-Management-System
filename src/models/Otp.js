// models/Otp.js
//
// Stores one-time passwords temporarily.
// Each document expires automatically after 10 minutes via MongoDB TTL index.
// When the user verifies successfully, the document is deleted immediately.

const mongoose = require("mongoose");

const otpSchema = new mongoose.Schema({
  email: {
    type:      String,
    required:  true,
    lowercase: true,
    trim:      true,
    index:     true,
  },
  otp: {
    type:     String,
    required: true, // hashed OTP — not plain text
  },
  expiresAt: {
    type:     Date,
    required: true,
  },
}, { timestamps: true });

// TTL index — MongoDB auto-deletes documents when expiresAt is reached
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("Otp", otpSchema);