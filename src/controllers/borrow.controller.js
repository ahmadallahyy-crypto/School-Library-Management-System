const BorrowRecord    = require("../models/BorrowRecord");
const borrowService   = require("../services/borrow.service");
const ApiResponse     = require("../utils/ApiResponse");
const ApiError        = require("../utils/ApiError");
const paginate        = require("../utils/paginate");
const {isValidObjectId} = require("../utils/isValidObjectId");


// ── POST /api/borrows ─────────────────────────────────────────────────────────
// Thin controller — reads req, calls service, sends response
// All rules (copy available, borrow limit, duplicate check) live in borrowService
exports.issueBook = async (req, res, next) => {
  try {
    // Grab only what this operation needs — extra fields are ignored
    const { bookId, studentId, dueDate, notes } = req.body;

    const record = await borrowService.issueBook(
      bookId,
      studentId,
      req.attendant._id, // injected from JWT — not supplied by client
      { dueDate, notes } // dueDate defaults to +14 days in service if omitted
    );

    // 201 — new BorrowRecord was created, comes back populated from service
    res.status(201).json(new ApiResponse(201, record, "Book issued successfully."));
  } catch (err) { next(err); }
};


// ── PUT /api/borrows/:id/return ───────────────────────────────────────────────
// Marks a borrow as returned — service handles record update + availableCopies increment
exports.returnBook = async (req, res, next) => {
  try {
    // Catch malformed ID early — avoids a Mongoose CastError deep in the stack
    if (!isValidObjectId(req.params.id)) throw new ApiError(400, "Invalid borrow record ID.");

    const { record, wasOverdue } = await borrowService.returnBook(
      req.params.id,
      req.attendant._id, // who accepted the return — injected from JWT
      { notes: req.body.notes }
    );

    // Build message based on whether return was late
    // daysOverdue is a virtual field on BorrowRecord — computed from returnedAt vs dueDate
    const message = wasOverdue
      ? `Book returned. Note: this was overdue by ${record.daysOverdue} day(s).`
      : "Book returned successfully.";

    // 200 — existing record was updated, nothing new created
    res.status(200).json(new ApiResponse(200, record, message));
  } catch (err) { next(err); }
};


// ── GET /api/borrows ──────────────────────────────────────────────────────────
// List all borrow records — supports filtering by status, student, book
exports.getAllBorrows = async (req, res, next) => {
  try {
    // Filter built dynamically — only adds a condition if the query param exists
    // Supports any combination: ?status=overdue&studentId=123&bookId=456
    const filter = {};
    if (req.query.status)    filter.status  = req.query.status;    // active | overdue | returned
    if (req.query.studentId) filter.student = req.query.studentId;
    if (req.query.bookId)    filter.book    = req.query.bookId;

    const { data, meta } = await paginate(BorrowRecord, filter, {
      page:  req.query.page,
      limit: req.query.limit,
      sort:  { borrowedAt: -1 }, // newest borrows first
      populate: [
        { path: "book",       select: "title isbn" },
        { path: "student",    select: "name admissionNumber email" },
        { path: "issuedBy",   select: "name staffId" },
        { path: "returnedTo", select: "name staffId" }, // null if book not yet returned
      ],
    });

    // meta contains total, page, limit, totalPages — frontend uses this for pagination UI
    res.status(200).json(new ApiResponse(200, data, "Borrow records fetched.", meta));
  } catch (err) { next(err); }
};


// ── GET /api/borrows/:id ──────────────────────────────────────────────────────
// Fetch a single borrow record with all references fully resolved
exports.getBorrowById = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) throw new ApiError(400, "Invalid borrow record ID.");

    // Four populates — replaces every ObjectId with actual document fields
    // select limits each to only the fields the client needs — smaller payload, no data leaks
    const record = await BorrowRecord.findById(req.params.id)
      .populate({ path: "book",       select: "title isbn genre" })
      .populate({ path: "student",    select: "name admissionNumber email" })
      .populate({ path: "issuedBy",   select: "name staffId" })
      .populate({ path: "returnedTo", select: "name staffId" }); // null if still out

    // findById returns null if no match — not an error by default, so we check manually
    if (!record) throw new ApiError(404, "Borrow record not found.");

    res.status(200).json(new ApiResponse(200, record, "Borrow record fetched."));
  } catch (err) { next(err); }
};