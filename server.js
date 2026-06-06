/**
 * server.js — Entry point.
 * 1. Connect to MongoDB
 * 2. Register background jobs (cron)
 * 3. Start the HTTP server
 * 4. Graceful shutdown on SIGTERM / SIGINT
 * 5. Catch unhandled errors
 */

const app          = require("./src/app");
const connectDB    = require("./src/config/db");
const logger       = require("./src/config/logger");
const { PORT }     = require("./src/config/env");
const { registerOverdueJob } = require("./src/jobs/overdue.job");

let server;

const start = async () => {
  // 1. Connect to MongoDB first — jobs and routes need the DB
  await connectDB();

  // 2. Register background jobs — runs after DB is ready
  // Overdue job checks every hour for books past their due date
  // and sends email notifications to students
  registerOverdueJob();

  // 3. Start HTTP server
  server = app.listen(PORT, () => {
    logger.info(`─────────────────────────────────────────────`);
    logger.info(` School Library API`);
    logger.info(` Mode:   ${process.env.NODE_ENV}`);
    logger.info(` Port:   ${PORT}`);
    logger.info(` Health: http://localhost:${PORT}/api/health`);
    logger.info(` Setup:  POST http://localhost:${PORT}/api/auth/setup`);
    logger.info(`─────────────────────────────────────────────`);
  });
};

// ── Graceful shutdown ─────────────────────────────────────────────────────────
const shutdown = (signal) => {
  logger.info(`${signal} received — shutting down gracefully...`);
  if (server) {
    server.close(() => {
      logger.info("HTTP server closed.");
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  logger.error(`Uncaught Exception: ${err.message}\n${err.stack}`);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error(`Unhandled Rejection: ${reason}`);
  process.exit(1);
});

start();