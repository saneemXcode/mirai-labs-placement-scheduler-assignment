import mongoose from "mongoose";

const ShortlistSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student" },
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company" }
}, { timestamps: true });

ShortlistSchema.index({ studentId: 1, companyId: 1 }, { unique: true });

export default mongoose.model("Shortlist", ShortlistSchema);
