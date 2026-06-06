// ─────────────────────────────────────────────────────────────────────────────
// borrow.service.js
//
// Business logic layer for all borrow/return operations.
// This file owns every rule that decides whether a borrow or return is allowed,
// and every DB write that makes it happen.
//
// NOTE: Transactions removed — local MongoDB runs as a standalone server which
// does not support transactions. Operations are sequential instead.
// In production with a replica set, transactions can be re-added.
//
// This file knows nothing about HTTP — no req, no res, no status codes in
// responses. It only throws ApiErrors and returns plain data.
// ─────────────────────────────────────────────────────────────────────────────

const Book         = require("../models/Book");
const Student      = require("../models/Student");
const BorrowRecord = require("../models/BorrowRecord");
const ApiError     = require("../utils/ApiError");
const { MAX_BORROWS_PER_STUDENT } = require("../config/env");

// Fallback to 3 if the env variable is missing or non-numeric.
const BORROW_LIMIT = Number(MAX_BORROWS_PER_STUDENT) || 3;


// ─── issueBook ────────────────────────────────────────────────────────────────
const issueBook = async (bookId, studentId, attendantId, options = {}) => {

  // ── 1. Validate Book ────────────────────────────────────────────────────────
  const book = await Book.findById(bookId);

  if (!book)          throw new ApiError(404, "Book not found.");
  if (!book.isActive) throw new ApiError(400, "This book is not currently active.");

  if (book.availableCopies <= 0) {
    throw new ApiError(400, `No copies of "${book.title}" are currently available.`);
  }

  // ── 2. Validate Student ─────────────────────────────────────────────────────
  const student = await Student.findById(studentId);

  if (!student)          throw new ApiError(404, "Student not found.");
  if (!student.isActive) throw new ApiError(400, "This student record is inactive.");

  // ── 3. Duplicate borrow check ───────────────────────────────────────────────
  // Prevent a student from borrowing the same book twice at the same time
  const alreadyBorrowed = await BorrowRecord.findOne({
    book:    bookId,
    student: studentId,
    status:  { $in: ["active", "overdue"] },
  });

  if (alreadyBorrowed) {
    throw new ApiError(409, `${student.name} already has "${book.title}" checked out.`);
  }

  // ── 4. Global borrow limit check ────────────────────────────────────────────
  // Count ALL books this student currently has out
  const activeBorrows = await BorrowRecord.countDocuments({
    student: studentId,
    status:  { $in: ["active", "overdue"] },
  });

  if (activeBorrows >= BORROW_LIMIT) {
    throw new ApiError(
      400,
      `${student.name} has reached the maximum of ${BORROW_LIMIT} borrowed books.`
    );
  }

  // ── 5. Decrement availableCopies ────────────────────────────────────────────
  // $inc is atomic — prevents race conditions where two attendants
  // issue the last copy at the same time
  await Book.findByIdAndUpdate(
    bookId,
    { $inc: { availableCopies: -1 } },
    { runValidators: true }
  );

  // ── 6. Create BorrowRecord ──────────────────────────────────────────────────
  const record = await BorrowRecord.create({
    book:     bookId,
    student:  studentId,
    issuedBy: attendantId,
    dueDate:  options.dueDate || undefined, // model pre-validate hook computes default (+14 days)
    notes:    options.notes,
  });

  // ── Populate for response ───────────────────────────────────────────────────
  // Done after create so extra reads don't block the write
  await record.populate([
    { path: "book",     select: "title isbn genre" },
    { path: "student",  select: "name admissionNumber email" },
    { path: "issuedBy", select: "name staffId" },
  ]);

  return record;
};


// ─── returnBook ───────────────────────────────────────────────────────────────
const returnBook = async (borrowId, attendantId, options = {}) => {

  // Fetch the borrow record with book and student populated
  const record = await BorrowRecord
    .findById(borrowId)
    .populate("book student");

  if (!record) throw new ApiError(404, "Borrow record not found.");

  // Idempotency guard — prevent processing the same return twice
  if (record.status === "returned") {
    throw new ApiError(400, "This book has already been returned.");
  }

  const now = new Date();
  const wasOverdue = now > record.dueDate; // true = returned after deadline

  // Update the record fields
  record.returnedAt = now;
  record.returnedTo = attendantId;
  record.status     = "returned";
  if (options.notes) record.notes = options.notes;

  // Save the updated record
  await record.save();

  // Give the copy back to the available pool
  await Book.findByIdAndUpdate(
    record.book._id,
    { $inc: { availableCopies: 1 } }
  );

  return { record, wasOverdue };
};


// ─── markOverdue ─────────────────────────────────────────────────────────────
// Called by a cron job — marks all active borrows past their due date as overdue
const markOverdue = async () => {
  const result = await BorrowRecord.updateMany(
    {
      status:  "active",
      dueDate: { $lt: new Date() },
    },
    {
      $set: { status: "overdue" },
    }
  );

  return result.modifiedCount;
};


module.exports = { issueBook, returnBook, markOverdue };