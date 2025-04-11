// models/Infraction.js
const mongoose = require('mongoose');

const infractionSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['behavioral', 'academic', 'attendance', 'other'],
    required: true
  },
  description: { type: String, required: true },
  date: { type: Date, default: Date.now },
  reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
});

const Infraction = mongoose.model('Infraction', infractionSchema);
module.exports = Infraction;