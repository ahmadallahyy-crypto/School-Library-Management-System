// ─────────────────────────────────────────────────────────────────────────────
// jobs/overdue.job.js
//
// Scheduled job that runs automatically every hour.
// Finds all active borrow records past their due date and marks them overdue.
// Also sends an email notification to each affected student.
//
// This job is registered in server.js — it starts automatically when the
// server starts and keeps running in the background.
// ─────────────────────────────────────────────────────────────────────────────

const cron            = require("node-cron");
const BorrowRecord    = require("../models/BorrowRecord");
const { sendOtpEmail } = require("../services/email.service");
const logger          = require("../config/logger");

/**
 * sendOverdueEmail
 * Sends an overdue notification to a student.
 * Reuses the existing Nodemailer transporter from email.service.js
 */
const sendOverdueEmail = async (to, studentName, bookTitle, dueDate, daysOverdue) => {
  const { EMAIL_USER } = require("../config/env");
  const nodemailer     = require("nodemailer");

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: EMAIL_USER,
      pass: require("../config/env").EMAIL_PASS,
    },
  });

  await transporter.sendMail({
    from:    `"LibraryMS" <${EMAIL_USER}>`,
    to,
    subject: `Overdue Book Notice — "${bookTitle}"`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #f9f9f9; border-radius: 12px;">
        <h2 style="color: #ff4d6d; margin-bottom: 8px;">LibraryMS — Overdue Notice</h2>
        <p style="color: #333; font-size: 16px;">Hi <strong>${studentName}</strong>,</p>
        <p style="color: #555; font-size: 14px;">
          The following book is <strong style="color: #ff4d6d;">${daysOverdue} day(s) overdue</strong>.
          Please return it to the library as soon as possible.
        </p>

        <div style="background: #fff; border: 2px solid #ff4d6d; border-radius: 12px; padding: 20px; margin: 24px 0;">
          <p style="margin: 0; font-size: 16px; font-weight: bold; color: #333;">${bookTitle}</p>
          <p style="margin: 8px 0 0; font-size: 13px; color: #999;">Due date: ${new Date(dueDate).toLocaleDateString()}</p>
        </div>

        <p style="color: #999; font-size: 12px;">
          Please return the book to any library attendant. Contact the library if you have any questions.
        </p>
      </div>
    `,
  });
};


/**
 * runOverdueJob
 * The main job function — finds overdue records and sends notifications.
 * Runs on a schedule defined below.
 */
const runOverdueJob = async () => {
  try {
    logger.info("[CRON] Running overdue check...");

    const now = new Date();

    // Find all active borrows that have passed their due date
    // Populate student email and book title for the notification email
    const overdueRecords = await BorrowRecord.find({
      status:  "active",
      dueDate: { $lt: now },
    }).populate([
      { path: "student", select: "name email" },
      { path: "book",    select: "title" },
    ]);

    if (overdueRecords.length === 0) {
      logger.info("[CRON] No overdue records found.");
      return;
    }

    logger.info(`[CRON] Found ${overdueRecords.length} overdue record(s). Processing...`);

    // Process each overdue record
    for (const record of overdueRecords) {
      try {
        // Mark as overdue in the DB
        record.status = "overdue";
        await record.save({ validateBeforeSave: false });

        // Calculate how many days overdue
        const daysOverdue = Math.floor(
          (now - new Date(record.dueDate)) / (1000 * 60 * 60 * 24)
        );

        // Send email notification to the student
        if (record.student?.email) {
          await sendOverdueEmail(
            record.student.email,
            record.student.name,
            record.book?.title || "Unknown Book",
            record.dueDate,
            daysOverdue
          );
          logger.info(`[CRON] Overdue email sent to ${record.student.email}`);
        }

      } catch (err) {
        // Log individual failures but continue processing others
        logger.error(`[CRON] Failed to process record ${record._id}: ${err.message}`);
      }
    }

    logger.info(`[CRON] Overdue job complete. Processed ${overdueRecords.length} record(s).`);

  } catch (err) {
    logger.error(`[CRON] Overdue job failed: ${err.message}`);
  }
};


/**
 * registerOverdueJob
 * Registers the cron schedule and starts the job.
 * Called once from server.js on startup.
 *
 * Schedule: "0 * * * *" = top of every hour (e.g. 1:00, 2:00, 3:00...)
 * For testing you can change to "* * * * *" = every minute
 */
const registerOverdueJob = () => {
  // Run every hour at minute 0
  cron.schedule("0 * * * *", runOverdueJob, {
    scheduled: true,
    timezone:  "Africa/Lagos", // adjust to your timezone
  });

  logger.info("[CRON] Overdue job registered — runs every hour.");
};

module.exports = { registerOverdueJob };