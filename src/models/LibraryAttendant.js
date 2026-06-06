// models/LibraryAttendant.js

const mongoose = require("mongoose");
const bcrypt   = require("bcryptjs");
const { BCRYPT_SALT_ROUNDS } = require("../config/env");

const libraryAttendantSchema = new mongoose.Schema(
  {
    name: {
      type:      String,
      required:  [true, "Name is required"],
      trim:      true,
      minlength: [2,  "Name must be at least 2 characters"],
      maxlength: [80, "Name cannot exceed 80 characters"],
    },
    email: {
      type:      String,
      required:  [true, "Email is required"],
      unique:    true,
      lowercase: true,
      trim:      true,
      match:     [/^\S+@\S+\.\S+$/, "Please provide a valid email address"],
      index:     true,
    },
    password: {
      type:      String,
      required:  [true, "Password is required"],
      minlength: [8, "Password must be at least 8 characters"],
      select:    false, // never returned in queries unless explicitly requested with .select("+password")
    },
    staffId: {
      type:     String,
      required: [true, "Staff ID is required"],
      unique:   true,
      trim:     true,
      uppercase: true,
      index:    true,
      match:    [/^[A-Z]{3}-\d{3}$/, "Staff ID must follow format XXX-### (e.g., LIB-001)"],
    },
    role: {
      type: String,
      enum: {
        values:  ["attendant", "admin"],
        message: "Role must be either attendant or admin",
      },
      default: "attendant",
    },
    shift: {
      type: String,
      enum: {
        values:  ["morning", "afternoon", "evening"],
        message: "Shift must be one of: morning, afternoon, evening",
      },
    },
    isActive: {
      type:    Boolean,
      default: true,
      index:   true,
    },
    refreshToken: {
      type:   String,
      select: false, // never returned in queries unless explicitly requested with .select("+refreshToken")
    },
    lastLoginAt: {
      type:    Date,
      default: null,
    },

    // ── NEW FIELD ────────────────────────────────────────────────────────────
    // Stores the exact moment a password was last changed.
    // Used by protect middleware (auth.middleware.js) to reject any access token
    // that was issued BEFORE this timestamp — meaning if someone had a stolen
    // token when you changed your password, that token immediately stops working.
    //
    // select: false — this field is excluded from all DB queries by default.
    // The middleware explicitly opts in with .select("+passwordChangedAt")
    // only when it needs to perform the stale-token check.
    // ────────────────────────────────────────────────────────────────────────
    passwordChangedAt: {
      type:   Date,
      select: false,
    },

  },
  {
    timestamps: true, // auto-manages createdAt and updatedAt fields
    toJSON: {
      transform: (doc, ret) => {
        // Strip sensitive fields whenever the document is serialised to JSON
        // (e.g. res.json(attendant) — even without calling toSafeObject())
        delete ret.password;
        delete ret.refreshToken;
        delete ret.passwordChangedAt; // never expose this timestamp to the client
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      transform: (doc, ret) => {
        // Same stripping applied when converting to a plain JS object
        delete ret.password;
        delete ret.refreshToken;
        delete ret.passwordChangedAt;
        delete ret.__v;
        return ret;
      },
    },
  }
);


// ─── Pre-save hook ────────────────────────────────────────────────────────────
// Runs automatically before every .save() call.
// Only re-hashes the password if it was actually modified —
// avoids double-hashing on unrelated saves (e.g. updating lastLoginAt).
libraryAttendantSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, BCRYPT_SALT_ROUNDS);
  next();
});


// ─── Pre-validate hook ────────────────────────────────────────────────────────
// Normalises staffId before validation runs — ensures the regex check always
// sees a clean uppercase, trimmed value regardless of what the caller sent.
libraryAttendantSchema.pre("validate", function (next) {
  if (this.staffId) {
    this.staffId = this.staffId.trim().toUpperCase();
  }
  next();
});


// ─── Instance methods ─────────────────────────────────────────────────────────

/**
 * comparePassword
 * Compares a plain-text candidate password against the stored bcrypt hash.
 * Returns true if they match, false otherwise.
 * Used by authService.login() and authService.changePassword().
 */
libraryAttendantSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

/**
 * setRefreshToken
 * Saves a new refresh token (or null to clear it) directly on the document.
 * validateBeforeSave: false — only refreshToken is changing, no need to re-run all validators.
 */
libraryAttendantSchema.methods.setRefreshToken = async function (token) {
  this.refreshToken = token;
  await this.save({ validateBeforeSave: false });
};

/**
 * updateLastLogin
 * Stamps the current time as the last login moment.
 * Called after a successful login in authService.login().
 */
libraryAttendantSchema.methods.updateLastLogin = async function () {
  this.lastLoginAt = new Date();
  await this.save({ validateBeforeSave: false });
};

/**
 * toSafeObject
 * Returns a plain JS object with all sensitive fields removed.
 * Used before sending attendant data in API responses.
 * toObject() transformer already strips these, but this method makes the
 * intent explicit and protects against accidental direct field access.
 */
libraryAttendantSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.refreshToken;
  delete obj.passwordChangedAt; // internal security field — never expose to client
  delete obj.__v;
  return obj;
};


// ─── Static methods ───────────────────────────────────────────────────────────

/**
 * findByEmailWithPassword
 * Convenience query that explicitly opts in to the password and refreshToken fields.
 * Used when you genuinely need to compare credentials.
 */
libraryAttendantSchema.statics.findByEmailWithPassword = function (email) {
  return this.findOne({ email }).select("+password +refreshToken");
};

/**
 * isEmailTaken
 * Checks whether an email is already registered, optionally excluding a specific
 * attendant ID (useful for update operations where the owner's own email is valid).
 */
libraryAttendantSchema.statics.isEmailTaken = async function (email, excludeAttendantId) {
  const attendant = await this.findOne({ email, _id: { $ne: excludeAttendantId } });
  return !!attendant;
};


module.exports = mongoose.model("LibraryAttendant", libraryAttendantSchema);