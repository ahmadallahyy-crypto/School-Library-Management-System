const mongoose        = require("mongoose");
const Student         = require("../models/Student");
const BorrowRecord    = require("../models/BorrowRecord");
const ApiResponse     = require("../utils/ApiResponse");
const ApiError        = require("../utils/ApiError");
const paginate        = require("../utils/paginate");
const pick            = require("../utils/pick");

// Fields allowed on create — anything else sent by the client is silently dropped
// by pick(), preventing mass-assignment attacks (e.g. caller injecting isActive: false)
const CREATABLE  = ["name", "email", "admissionNumber"];

// Fields allowed on update — admissionNumber is intentionally excluded because
// it is a permanent identifier that must never change after registration
const UPDATABLE  = ["name", "email", "isActive"];

// Hard cap on bulk-create to prevent oversized payloads and DB strain
const BULK_LIMIT = 50;


// ─── Helper: generateAdmissionNumber ─────────────────────────────────────────
// Automatically creates a unique admission number in the format SCH/YY/STU/00000
// e.g. SCH/26/STU/00001, SCH/26/STU/00002, etc.
//
// How it works:
// 1. Builds the prefix for the current year e.g. "SCH/26/STU/"
// 2. Finds the student with the highest existing sequence number this year
// 3. Increments that number by 1 and zero-pads it to 5 digits
//
// Called sequentially (not in parallel) during bulk create to prevent two
// concurrent calls from reading the same "last" number and generating duplicates
const generateAdmissionNumber = async () => {
  // slice(-2) takes the last 2 characters: 2026 → "26"
  const year   = new Date().getFullYear().toString().slice(-2);
  const prefix = `SCH/${year}/STU/`;

  // Find the student whose admissionNumber starts with this year's prefix
  // and has the highest sequence — sort descending so the first result is the largest
  const last = await Student.findOne(
    { admissionNumber: { $regex: `^${prefix}` } }, // $regex matches the prefix
    { admissionNumber: 1 },                         // only fetch this one field
    { sort: { admissionNumber: -1 } }               // highest sequence number first
  );

  let nextSeq = 1; // default: first student this year starts at 00001
  if (last) {
    // Split "SCH/26/STU/00003" by "/" → ["SCH", "26", "STU", "00003"]
    // .pop() takes the last element → "00003"
    // parseInt removes leading zeros → 3
    const lastSeq = parseInt(last.admissionNumber.split("/").pop(), 10);
    nextSeq = lastSeq + 1; // increment by 1 for the next student
  }

  // padStart(5, "0") ensures the number is always 5 digits:
  // 1 → "00001", 42 → "00042", 1000 → "01000"
  return `${prefix}${String(nextSeq).padStart(5, "0")}`;
};


// ── GET /api/students ─────────────────────────────────────────────────────────
// Returns a paginated list of students, each with a live activeBorrows count.
// Supports optional ?search=, ?isActive=, ?page=, ?limit= query params.
// Defaults to active students only — inactive students are hidden unless
// the caller explicitly passes ?isActive=false.
exports.getAllStudents = async (req, res, next) => {
  try {
    const filter = {};

    // Full-text search on the name field — requires a text index on the model
    if (req.query.search)   filter.$text    = { $search: req.query.search };

    // Default to active students only — pass ?isActive=false to include inactive
    if (req.query.isActive) filter.isActive = req.query.isActive === "true";
    else                    filter.isActive = true;

    // paginate() handles page/limit/sort and returns { data, meta }
    const { data, meta } = await paginate(Student, filter, {
      page:  req.query.page,
      limit: req.query.limit,
      sort:  req.query.search ? { score: { $meta: "textScore" } } : { name: 1 },
    });

    // ── Attach activeBorrows count to each student ────────────────────────────
    // Problem: getAllStudents returns a list but doesn't include borrow counts.
    // getStudentById does this for one student, but calling it N times for a
    // list would be N+1 queries — very slow.
    //
    // Solution: one aggregation query that counts active/overdue borrows for
    // ALL students in the current page at once, then map the counts back.
    //
    // Step 1 — collect all student IDs from the current page
    const studentIds = data.map(s => s._id);

    // Step 2 — one aggregation: match borrows for these students that are
    // active or overdue, then group by student ID and count
    const borrowCounts = await BorrowRecord.aggregate([
      {
        $match: {
          student: { $in: studentIds },           // only borrows for this page's students
          status:  { $in: ["active", "overdue"] }, // only currently checked-out books
        },
      },
      {
        $group: {
          _id:   "$student", // group by student ID
          count: { $sum: 1 }, // count matching borrow records
        },
      },
    ]);

    // Step 3 — build a lookup map { studentId: count } for O(1) access
    const countMap = {};
    borrowCounts.forEach(b => { countMap[b._id.toString()] = b.count; });

    // Step 4 — attach activeBorrows to each student document
    // toObject() converts Mongoose document to plain JS object so we can spread it
    // Default to 0 if no active borrows found in the map
    const enriched = data.map(s => ({
      ...s.toObject(),
      activeBorrows: countMap[s._id.toString()] || 0,
    }));

    const message = enriched.length === 0 ? "No students found." : "Students fetched.";
    res.status(200).json(new ApiResponse(200, enriched, message, meta));
  } catch (err) { next(err); }
};


// ── GET /api/students/:id ─────────────────────────────────────────────────────
// Returns a single student by their MongoDB ObjectId, plus a live count of
// how many books they currently have checked out (active or overdue borrows).
exports.getStudentById = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, "Invalid student ID.");

    const student = await Student.findById(req.params.id);
    if (!student) throw new ApiError(404, "Student not found.");

    // Count only current borrows (active + overdue) — returned books are excluded
    const activeBorrows = await BorrowRecord.countDocuments({
      student: req.params.id,
      status:  { $in: ["active", "overdue"] },
    });

    // toObject() converts Mongoose document to plain JS object so we can spread it
    res.status(200).json(
      new ApiResponse(200, { ...student.toObject(), activeBorrows }, "Student fetched.")
    );
  } catch (err) { next(err); }
};


// ── POST /api/students ────────────────────────────────────────────────────────
// Registers a single new student.
// admissionNumber is auto-generated if the caller does not supply one.
exports.createStudent = async (req, res, next) => {
  try {
    const safeData = pick(req.body, CREATABLE);

    // Auto-generate admissionNumber if omitted
    if (!safeData.admissionNumber) {
      safeData.admissionNumber = await generateAdmissionNumber();
    }

    const student = await Student.create(safeData);
    res.status(201).json(new ApiResponse(201, student, "Student registered successfully."));
  } catch (err) { next(err); }
};


// ── POST /api/students/bulk ───────────────────────────────────────────────────
// Registers up to 50 students in a single request.
// admissionNumbers are auto-generated sequentially to prevent duplicates.
// Partial success returns HTTP 207 Multi-Status.
exports.createBulkStudents = async (req, res, next) => {
  try {
    if (!Array.isArray(req.body.students) || req.body.students.length === 0) {
      throw new ApiError(400, "Request body must include a non-empty 'students' array.");
    }
    if (req.body.students.length > BULK_LIMIT) {
      throw new ApiError(400, `Bulk insert is limited to ${BULK_LIMIT} students per request.`);
    }

    const created = [];
    const errors  = [];

    for (let i = 0; i < req.body.students.length; i++) {
      const doc = pick(req.body.students[i], CREATABLE);

      if (!doc.admissionNumber) {
        doc.admissionNumber = await generateAdmissionNumber();
      }

      try {
        const student = await Student.create(doc);
        created.push(student.toObject());
      } catch (err) {
        errors.push({
          index: i,
          message: err.code === 11000
            ? `Duplicate value for field: ${Object.keys(err.keyValue ?? {})[0] ?? "unknown"}`
            : err.message,
        });
      }
    }

    // Partial success — some inserted, some failed
    if (created.length > 0 && errors.length > 0) {
      return res.status(207).json({
        success: true,
        message: `Partial insert: ${created.length} succeeded, ${errors.length} failed.`,
        data:    created,
        errors,
      });
    }

    if (created.length === 0) {
      throw new ApiError(400, "All inserts failed. Check the errors array for details.");
    }

    res.status(201).json(
      new ApiResponse(201, created, `${created.length} student(s) registered successfully.`)
    );
  } catch (err) { next(err); }
};


// ── PUT /api/students/:id ─────────────────────────────────────────────────────
// Updates an existing student's profile.
// admissionNumber is excluded from UPDATABLE — immutable after registration.
exports.updateStudent = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, "Invalid student ID.");

    const safeData = pick(req.body, UPDATABLE);

    if (Object.keys(safeData).length === 0) {
      throw new ApiError(400, `No valid fields. Updatable: ${UPDATABLE.join(", ")}.`);
    }

    const student = await Student.findByIdAndUpdate(
      req.params.id,
      safeData,
      { new: true, runValidators: true }
    );

    if (!student) throw new ApiError(404, "Student not found.");

    res.status(200).json(new ApiResponse(200, student, "Student updated successfully."));
  } catch (err) { next(err); }
};


// ── DELETE /api/students/:id ──────────────────────────────────────────────────
// Permanently deletes a student record.
// Blocked if the student has books currently checked out.
exports.deleteStudent = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, "Invalid student ID.");

    // Block deletion if any books are still checked out
    const activeBorrows = await BorrowRecord.countDocuments({
      student: req.params.id,
      status:  { $in: ["active", "overdue"] },
    });

    if (activeBorrows > 0) {
      throw new ApiError(
        400,
        `Cannot delete student — they have ${activeBorrows} book(s) currently checked out.`
      );
    }

    const student = await Student.findByIdAndDelete(req.params.id);
    if (!student) throw new ApiError(404, "Student not found.");

    res.status(200).json(
      new ApiResponse(200, null, `Student "${student.name}" deleted successfully.`)
    );
  } catch (err) { next(err); }
};


// ── GET /api/students/:id/borrows ─────────────────────────────────────────────
// Returns the full borrow history for one student.
// Supports optional ?status= filter (active | overdue | returned) and pagination.
exports.getStudentBorrows = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, "Invalid student ID.");

    const student = await Student.findById(req.params.id);
    if (!student) throw new ApiError(404, "Student not found.");

    const filter = { student: req.params.id };
    if (req.query.status) filter.status = req.query.status;

    const { data, meta } = await paginate(BorrowRecord, filter, {
      page:     req.query.page,
      limit:    req.query.limit,
      sort:     { borrowedAt: -1 },
      populate: [
        { path: "book",     select: "title isbn genre" },
        { path: "issuedBy", select: "name staffId" },
      ],
    });

    res.status(200).json(
      new ApiResponse(200, data, `Borrow history for ${student.name}.`, meta)
    );
  } catch (err) { next(err); }
};