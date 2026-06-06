// services/email.service.js

const nodemailer = require("nodemailer");
const { EMAIL_USER, EMAIL_PASS } = require("../config/env");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS,
  },
});

/**
 * sendOtpEmail
 * Sends a 6-digit OTP code to the attendant's email address.
 */
const sendOtpEmail = async (to, otp, name) => {
  await transporter.sendMail({
    from:    `"LibraryMS" <${EMAIL_USER}>`,
    to,
    subject: "Your LibraryMS Login Code",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #f9f9f9; border-radius: 12px;">
        <h2 style="color: #6c63ff; margin-bottom: 8px;">LibraryMS</h2>
        <p style="color: #333; font-size: 16px;">Hi <strong>${name}</strong>,</p>
        <p style="color: #555; font-size: 14px;">Use the code below to complete your login. It expires in <strong>10 minutes</strong>.</p>
        <div style="background: #fff; border: 2px dashed #6c63ff; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
          <span style="font-size: 40px; font-weight: 800; letter-spacing: 12px; color: #6c63ff;">${otp}</span>
        </div>
        <p style="color: #999; font-size: 12px;">If you didn't request this code, ignore this email. Your account is safe.</p>
      </div>
    `,
  });
};

module.exports = { sendOtpEmail };