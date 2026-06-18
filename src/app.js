const express  = require("express");
const cors     = require("cors");
const helmet   = require("helmet");
const morgan   = require("morgan");
const { NODE_ENV }       = require("./config/env");
const logger             = require("./config/logger");
const { apiLimiter }     = require("./middleware/rateLimit.middleware");
const errorMiddleware    = require("./middleware/error.middleware");
const routes             = require("./routes/index.js");

const app = express();

// ── Security headers ──────────────────────────────────────────────────────────
// Sets X-Frame-Options, Content-Security-Policy, etc.
app.use(helmet());
console.log('[DEBUG] NODE_ENV:', NODE_ENV);
console.log('[DEBUG] ALLOWED_ORIGINS raw:', JSON.stringify(process.env.ALLOWED_ORIGINS));
console.log('[DEBUG] ALLOWED_ORIGINS parsed:', process.env.ALLOWED_ORIGINS?.split(","));


// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors({
  origin:         NODE_ENV === "production"
    ? process.env.ALLOWED_ORIGINS?.split(",") || []
    : "*",
  methods:        ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

// ── HTTP request logging ──────────────────────────────────────────────────────
app.use(morgan(NODE_ENV === "development" ? "dev" : "combined", {
  stream: { write: (msg) => logger.info(msg.trim()) },
}));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: "10kb" }));        // Reject huge payloads


// ── Global rate limiter ───────────────────────────────────────────────────────
// Applied to all /api/* routes. Login has its own stricter limiter.
app.use("/api", apiLimiter);

// ── API routes ────────────────────────────────────────────────────────────────
app.use("/api", routes);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// ── Global error handler ──────────────────────────────────────────────────────
// MUST be last. Catches every error passed via next(error).
app.use(errorMiddleware);


// TEMP: log all registered routes
app._router.stack.forEach(r => {
  if (r.route) console.log(r.route.path);
  else if (r.handle && r.handle.stack) {
    r.handle.stack.forEach(s => {
      if (s.route) console.log(s.route.path);
    });
  }
});

module.exports = app;
