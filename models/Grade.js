// models/Grade.js
const mongoose = require('mongoose');

const gradeSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  courseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: true,
    index: true
  },
  assignmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Assignment',
    index: true
  },
  score: { type: Number, required: true },
  comment: { type: String },
  gradedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  gradedAt: { type: Date, default: Date.now }
});

// Create compound index for efficient lookups
gradeSchema.index({ studentId: 1, courseId: 1 });

const Grade = mongoose.model('Grade', gradeSchema);
module.exports = Grade;