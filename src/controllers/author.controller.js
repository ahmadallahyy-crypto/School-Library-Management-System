const Author          = require("../models/Author");
const Book            = require("../models/Book");
const ApiResponse     = require("../utils/ApiResponse");
const ApiError        = require("../utils/ApiError");
const paginate        = require("../utils/paginate");
const pick            = require("../utils/pick");
const { isValidObjectId } = require("../utils/isValidObjectId");

// Fields allowed during create and update — any other field sent is ignored
const CREATABLE = ["name", "bio", "nationality"];
const UPDATABLE = ["name", "bio", "nationality"];


// ── GET /api/authors ──────────────────────────────────────────────────────────
// Fetch all authors — supports text search and pagination
exports.getAllAuthors = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.search) filter.$text = { $search: req.query.search };

    const { data, meta } = await paginate(Author, filter, {
      page:  req.query.page,
      limit: req.query.limit,
      sort:  { name: 1 },
    });

    const message = data.length === 0 ? "No authors found." : "Authors fetched.";
    res.status(200).json(new ApiResponse(200, data, message, meta));

  } catch (err) { next(err); }
};


// ── GET /api/authors/:id ──────────────────────────────────────────────────────
// Fetch one author + all their active books via virtual populate
exports.getAuthorById = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) throw new ApiError(400, "Invalid author ID.");

    const author = await Author.findById(req.params.id).populate({
      path:   "books",              // virtual field defined on Author model
      select: "title isbn genre availableCopies isActive", // only send needed fields
      match:  { isActive: true },   // only include active books — filters out deleted ones
    });

    if (!author) throw new ApiError(404, "Author not found.");

    res.status(200).json(new ApiResponse(200, author, "Author fetched."));
  } catch (err) { next(err); }
};


// ── POST /api/authors ─────────────────────────────────────────────────────────
// Create a new author — only CREATABLE fields are saved, everything else ignored
exports.createAuthor = async (req, res, next) => {
  try {
    // pick() strips any fields not in CREATABLE — prevents unwanted data being saved
    const safeData = pick(req.body, CREATABLE);
    const author   = await Author.create(safeData);

    res.status(201).json(new ApiResponse(201, author, "Author created."));
  } catch (err) { next(err); }
};


// ── PUT /api/authors/:id ──────────────────────────────────────────────────────
// Update an author — only UPDATABLE fields are accepted
exports.updateAuthor = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) throw new ApiError(400, "Invalid author ID.");

    const safeData = pick(req.body, UPDATABLE);

    // Reject if client sent no valid fields at all — no point hitting the DB
    if (Object.keys(safeData).length === 0) {
      throw new ApiError(400, `No valid fields. Updatable: ${UPDATABLE.join(", ")}.`);
    }

    const author = await Author.findByIdAndUpdate(
      req.params.id,
      safeData,
      { new: true, runValidators: true } // new: true returns updated doc, runValidators enforces schema rules
    );

    if (!author) throw new ApiError(404, "Author not found.");

    res.status(200).json(new ApiResponse(200, author, "Author updated."));
  } catch (err) { next(err); }
};


// ── DELETE /api/authors/:id ───────────────────────────────────────────────────
// Delete an author — blocked if they still have active books linked to them
exports.deleteAuthor = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) throw new ApiError(400, "Invalid author ID.");

    // Safety check — cannot delete an author if active books still reference them
    // Deleting would leave those books with a broken author reference
    const bookCount = await Book.countDocuments({ author: req.params.id, isActive: true });
    if (bookCount > 0) {
      throw new ApiError(
        400,
        `Cannot delete author — ${bookCount} active book(s) are linked to them.`
      );
    }

    const author = await Author.findByIdAndDelete(req.params.id);
    if (!author) throw new ApiError(404, "Author not found.");

    // null data — nothing to return after deletion
    res.status(200).json(
      new ApiResponse(200, null, `Author "${author.name}" deleted successfully.`)
    );
  } catch (err) { next(err); }
};