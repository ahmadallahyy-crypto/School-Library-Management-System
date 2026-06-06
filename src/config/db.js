// config/db.js

const mongoose = require("mongoose");
const { MONGO_URI, NODE_ENV } = require("./env");
const logger = require("./logger");

/**
 * Sleep helper for retry delays
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Connect to MongoDB with retry logic and event handlers.
 * @param {number} retries - Max retry attempts (default 5)
 * @param {number} delayMs - Base delay between retries (exponential)
 */
const connectDB = async (retries = 5, delayMs = 2000) => {
  // Remove existing listeners to avoid duplicates on re‑calls
  mongoose.connection.removeAllListeners("disconnected");
  mongoose.connection.removeAllListeners("reconnected");
  mongoose.connection.removeAllListeners("error");

  // Setup event handlers once
  mongoose.connection.on("disconnected", () => {
    logger.warn("⚠️ MongoDB disconnected — attempting to reconnect...");
  });
  mongoose.connection.on("reconnected", () => {
    logger.info("✅ MongoDB reconnected successfully");
  });
  mongoose.connection.on("error", (err) => {
    logger.error(`MongoDB connection error: ${err.message}`);
  });

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await mongoose.connect(MONGO_URI);
      logger.info("✅ MongoDB connected successfully");
      // Optional: log host only in development
      if (NODE_ENV === "development") {
        logger.debug(`Host: ${mongoose.connection.host}`);
      }
      return; // Success – exit function
    } catch (err) {
      logger.error(`❌ MongoDB connection attempt ${attempt}/${retries} failed: ${err.message}`);
      if (attempt === retries) {
        logger.error("Could not connect to MongoDB after multiple retries. Exiting...");
        process.exit(1);
      }
      const waitTime = delayMs * Math.pow(2, attempt - 1); // exponential backoff
      logger.info(`Retrying in ${waitTime / 1000} seconds...`);
      await sleep(waitTime);
    }
  }
};

// Graceful shutdown (only one listener)
const gracefulShutdown = async () => {
  logger.info("Shutting down gracefully...");
  await mongoose.connection.close();
  logger.info("MongoDB connection closed");// config/db.js

  const mongoose = require("mongoose");
  const { MONGO_URI, NODE_ENV } = require("./env");
  const logger = require("./logger");

  // ─── Validate env config at startup ─────────────────────────────────────────
  if (!MONGO_URI) {
    throw new Error("MONGO_URI must be defined in env config.");
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Sleep helper for retry delays.
   * @param {number} ms - Milliseconds to wait
   */
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * Immediately ping the database to verify the connection is truly alive.
   * This prevents false positives where mongoose.connect() resolves but the
   * connection is unusable (e.g., authentication missing, network half‑open,
   * or the database disappeared right after the handshake).
   */
  const pingDatabase = async () => {
    try {
      await mongoose.connection.db.admin().ping();
      return true;
    } catch (err) {
      logger.error(`Post‑connect ping failed: ${err.message}`);
      return false;
    }
  };

  // ─── Event handlers ───────────────────────────────────────────────────────────
  // Registered once at module load — not inside connectDB — so they survive
  // re‑calls without risk of duplicating or removing third‑party listeners.

  mongoose.connection.on("disconnected", () => {
    logger.warn("⚠️  MongoDB disconnected — Mongoose will attempt to reconnect automatically.");
  });

  mongoose.connection.on("reconnected", () => {
    logger.info("✅ MongoDB reconnected successfully.");
  });

  mongoose.connection.on("error", (err) => {
    logger.error(`MongoDB connection error: ${err.message}`);
  });

  // ─── connectDB ───────────────────────────────────────────────────────────────

  /**
   * Called once at app startup. Establishes the MongoDB connection with
   * exponential‑backoff retry logic.
   *
   * Tight heartbeat + timeout settings (5s) help detect dropped connections faster.
   * After a successful Mongoose connect, we run a ping to confirm the connection
   * is actually usable. If the ping fails, the connection is closed and we retry.
   *
   * @param {number} retries  - Max retry attempts (default: 5)
   * @param {number} delayMs  - Base delay in ms between retries (doubles each attempt)
   */
  const connectDB = async (retries = 5, delayMs = 2000) => {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await mongoose.connect(MONGO_URI, {
          serverSelectionTimeoutMS: 5000, // how long to wait for a server before failing
          heartbeatFrequencyMS: 5000,     // how often to ping the server (detects drops)
          socketTimeoutMS: 45000,         // how long a socket operation can take
        });

        // 🔍 Verify the connection is genuinely alive
        const isAlive = await pingDatabase();
        if (!isAlive) {
          // Close the unusable connection and treat as a failed attempt
          await mongoose.connection.close();
          throw new Error("Connection not usable after ping");
        }

        logger.info("✅ MongoDB connected successfully.");
        if (NODE_ENV === "development") {
          logger.debug(`   Host: ${mongoose.connection.host}`);
        }

        return; // Connection established — exit function
      } catch (err) {
        logger.error(
          `❌ MongoDB connection attempt ${attempt}/${retries} failed: ${err.message}`
        );

        if (attempt === retries) {
          logger.error("Could not connect to MongoDB after maximum retries. Exiting...");
          process.exit(1); // Unrecoverable — exit with error code
        }

        const waitTime = delayMs * Math.pow(2, attempt - 1); // exponential backoff
        logger.info(`   Retrying in ${waitTime / 1000}s...`);
        await sleep(waitTime);
      }
    }
  };

  // ─── Graceful shutdown ────────────────────────────────────────────────────────

  /**
   * Closes the MongoDB connection cleanly before the process exits.
   * Triggered by SIGINT (Ctrl+C) and SIGTERM (container stop / deploy).
   * Exits with code 0 — clean shutdown.
   */
  const gracefulShutdown = async (signal) => {
    logger.info(`${signal} received — shutting down gracefully...`);
    await mongoose.connection.close();
    logger.info("MongoDB connection closed. Goodbye.");
    process.exit(0); // ✅ 0 = clean exit
  };

  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

  module.exports = connectDB;
  process.exit(1);
};

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

module.exports = connectDB;