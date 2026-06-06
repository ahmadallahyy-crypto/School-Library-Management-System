const Book            = require("../models/Book");
const ApiResponse     = require("../utils/ApiResponse");
const ApiError        = require("../utils/ApiError");
const paginate        = require("../utils/paginate");
const pick            = require("../utils/pick");
const { isValidObjectId } = require("../utils/isValidObjectId");
// Fields allowed on create — anything else sent by client is ignored
const CREATABLE = ["title", "isbn", "author", "genre", "description",
                   "publishedYear", "publisher", "totalCopies", "shelfLocation"];

// author and isbn excluded — they form the book's identity and cannot change after creation
const UPDATABLE = ["title", "genre", "description", "publishedYear",
                   "publisher", "totalCopies", "shelfLocation", "isActive"];


// ── GET /api/books ────────────────────────────────────────────────────────────
// Fetch all books — supports search, filters and pagination
exports.getAllBooks = async (req, res, next) => {
  try {
    const filter = { isActive: true }; // default — only show active books

    if (req.query.search)    filter.$text          = { $search: req.query.search }; // full-text search
    if (req.query.genre)     filter.genre          = new RegExp(req.query.genre, "i"); // case-insensitive genre match
    if (req.query.author)    filter.author         = req.query.author;                // filter by author id
    if (req.query.available === "true") filter.availableCopies = { $gt: 0 };         // only books with copies on shelf
    if (req.query.showInactive === "true") delete filter.isActive;                   // admin override — show all books

    const { data, meta } = await paginate(Book, filter, {
      page:     req.query.page,
      limit:    req.query.limit,
      sort:     req.query.search ? { score: { $meta: "textScore" } } : { createdAt: -1 }, // relevance if searching, newest if not
      populate: { path: "author", select: "name nationality" }, // attach author details to each book
    });

    res.status(200).json(new ApiResponse(200, data, "Books fetched.", meta));
  } catch (err) { next(err); }
};


// ── GET /api/books/:id ────────────────────────────────────────────────────────
// Fetch one book with full author details
exports.getBookById = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) throw new ApiError(400, "Invalid book ID.");

    const book = await Book.findById(req.params.id)
      .populate({ path: "author", select: "name nationality bio" }); // more author detail than list view

    if (!book) throw new ApiError(404, "Book not found.");

    res.status(200).json(new ApiResponse(200, book, "Book fetched."));
  } catch (err) { next(err); }
};


// ── POST /api/books ───────────────────────────────────────────────────────────
// Create a new book — only CREATABLE fields are saved
exports.createBook = async (req, res, next) => {
  try {
    const safeData = pick(req.body, CREATABLE); // strip any fields not in CREATABLE
    const book     = await Book.create(safeData);
    await book.populate({ path: "author", select: "name" }); // attach author name to response

    res.status(201).json(new ApiResponse(201, book, "Book added to library."));
  } catch (err) { next(err); }
};


// ── PUT /api/books/:id ────────────────────────────────────────────────────────
// Update a book — handles availableCopies automatically when totalCopies changes
exports.updateBook = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) throw new ApiError(400, "Invalid book ID.");

    const safeData = pick(req.body, UPDATABLE);
    if (Object.keys(safeData).length === 0) {
      throw new ApiError(400, `No valid fields. Updatable: ${UPDATABLE.join(", ")}.`);
    }

    // Special case — if totalCopies is changing, recalculate availableCopies
    if (safeData.totalCopies !== undefined) {
      const existing = await Book.findById(req.params.id);
      if (!existing) throw new ApiError(404, "Book not found.");

      // checkedOut = how many copies are currently with students
      const checkedOut = existing.totalCopies - existing.availableCopies;

      // Cannot reduce total below checked out — those copies don't physically exist on shelf
      if (safeData.totalCopies < checkedOut) {
        throw new ApiError(
          400,
          `Cannot reduce total copies below ${checkedOut} — ` +
          `that many copies are currently checked out.`
        );
      }

      // Recalculate available = new total - still checked out
      safeData.availableCopies = safeData.totalCopies - checkedOut;
    }

    const book = await Book.findByIdAndUpdate(
      req.params.id,
      safeData,
      { new: true, runValidators: true } // new: true returns updated doc
    ).populate({ path: "author", select: "name" });

    if (!book) throw new ApiError(404, "Book not found.");

    res.status(200).json(new ApiResponse(200, book, "Book updated."));
  } catch (err) { next(err); }
};


// ── DELETE /api/books/:id ─────────────────────────────────────────────────────
// Smart delete — soft deletes if copies are out, hard deletes if all returned
exports.deleteBook = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) throw new ApiError(400, "Invalid book ID.");

    const book = await Book.findById(req.params.id);
    if (!book) throw new ApiError(404, "Book not found.");

    if (book.checkedOutCopies > 0) {
      // Soft delete — set isActive to false but keep the record
      // Needed to preserve borrow history that still references this book
      book.isActive = false;
      await book.save();
      return res.status(200).json(
        new ApiResponse(
          200, null,
          `Book deactivated — ${book.checkedOutCopies} copy/copies still out on loan.`
        )
      );
    }

    // Hard delete — all copies are on the shelf, safe to remove permanently
    await Book.findByIdAndDelete(req.params.id);
    res.status(200).json(
      new ApiResponse(200, null, `Book "${book.title}" deleted successfully.`)
    );
  } catch (err) { next(err); }
};