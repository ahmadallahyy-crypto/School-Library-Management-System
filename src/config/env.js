const dotenv = require("dotenv");
dotenv.config();

// ─── Required variable guard ──────────────────────────────────────────────────
// The app crashes immediately at startup with a clear message if any required
// variable is missing — far better than a cryptic runtime failure later.
const required = ["MONGO_URI", "JWT_SECRET", "JWT_REFRESH_SECRET"];
const missing  = required.filter((k) => !process.env[k]);

if (missing.length) {
  throw new Error(
    `\n[ENV] Missing required environment variables: ${missing.join(", ")}\n` +
    `Copy .env.example to .env and fill in the values.\n`
  );
}

module.exports = {
  NODE_ENV:               process.env.NODE_ENV               || "development",
  PORT:                   parseInt(process.env.PORT, 10)      || 5000,
  MONGO_URI:              process.env.MONGO_URI,

  JWT_SECRET:             process.env.JWT_SECRET,
  JWT_EXPIRES_IN:         process.env.JWT_EXPIRES_IN          || "7d",
  JWT_REFRESH_SECRET:     process.env.JWT_REFRESH_SECRET,
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN  || "30d",

  BCRYPT_SALT_ROUNDS:     parseInt(process.env.BCRYPT_SALT_ROUNDS,  10) || 12,
  RATE_LIMIT_WINDOW_MS:   parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
  RATE_LIMIT_MAX:         parseInt(process.env.RATE_LIMIT_MAX,        10) || 100,

  MAX_BORROWS_PER_STUDENT: parseInt(process.env.MAX_BORROWS_PER_STUDENT, 10) || 3,
  LOAN_PERIOD_DAYS:        parseInt(process.env.LOAN_PERIOD_DAYS,        10) || 14,

  // Seed script values
  SEED_ADMIN_NAME:       process.env.SEED_ADMIN_NAME     || "Head Librarian",
  SEED_ADMIN_EMAIL:      process.env.SEED_ADMIN_EMAIL    || "admin@school.com",
  SEED_ADMIN_PASSWORD:   process.env.SEED_ADMIN_PASSWORD || "Admin@12345",
  SEED_ADMIN_STAFF_ID:   process.env.SEED_ADMIN_STAFF_ID || "LIB-ADMIN-001",

  // Email — used by Nodemailer to send OTP codes via Gmail
  EMAIL_USER: process.env.EMAIL_USER, // your Gmail address
  EMAIL_PASS: process.env.EMAIL_PASS, // 16-character Google App Password
};