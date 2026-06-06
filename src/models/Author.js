const mongoose = require("mongoose");

const authorSchema = new mongoose.Schema(
  {
    name: {
      type:      String,
      required:  [true, "Author name is required"],
      trim:      true,
      unique:    true,
      minlength: [2,   "Name must be at least 2 characters"],
      maxlength: [100, "Name cannot exceed 100 characters"],
    },
    bio: {
      type:      String,
      trim:      true,
      maxlength: [1000, "Bio cannot exceed 1000 characters"],
    },
    nationality: {
      type:      String,
      trim:      true,
      maxlength: [100, "Nationality cannot exceed 100 characters"],
    },
  },
  {
    timestamps: true,
    toJSON:     { virtuals: true },
    toObject:   { virtuals: true },
  }
);

authorSchema.virtual("books", {
  ref:          "Book",
  localField:   "_id",
  foreignField: "author",
});

// Keep only text index — unique:true above already creates the name_1 index
authorSchema.index({ name: "text" });

module.exports = mongoose.model("Author", authorSchema);