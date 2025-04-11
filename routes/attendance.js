// routes/attendance.js
const express = require('express');
const Attendance = require('../models/Attendance');
const Course = require('../models/Course');
const User = require('../models/User');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

const router = express.Router();

// Create a new attendance record (teachers and admin only)
router.post('/', authenticateToken, authorizeRoles(['admin', 'teacher']), async (req, res) => {
  try {
    const { studentId, courseId, date, status, reason } = req.body;

    // Verify course exists
    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    // Check teacher permission
    if (req.user.role === 'teacher' && course.teacherId.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Verify student is enrolled in the course
    if (!course.students.includes(studentId)) {
      return res.status(400).json({ message: 'Student is not enrolled in this course' });
    }

    // Check if attendance record already exists for this date/student/course
    const existingRecord = await Attendance.findOne({
      studentId,
      courseId,
      date: new Date(date)
    });

    if (existingRecord) {
      return res.status(400).json({ message: 'Attendance record already exists for this date. Use PUT to update.' });
    }

    const newAttendance = new Attendance({
      studentId,
      courseId,
      date,
      status,
      reason,
      recordedBy: req.user.id
    });

    await newAttendance.save();

    res.status(201).json({
      message: 'Attendance recorded successfully',
      attendance: newAttendance
    });
  } catch (error) {
    console.error('Attendance creation error:', error);
    res.status(500).json({ message: 'Server error recording attendance' });
  }
});

// Get attendance records with filtering
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { studentId, courseId, date, startDate, endDate, status, page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    // Build query
    let query = {};

    // Filter by student
    if (studentId) query.studentId = studentId;

    // Filter by course
    if (courseId) query.courseId = courseId;

    // Filter by date
    if (date) {
      // Single date
      const searchDate = new Date(date);
      query.date = {
        $gte: new Date(searchDate.setHours(0, 0, 0, 0)),
        $lt: new Date(searchDate.setHours(23, 59, 59, 999))
      };
    } else if (startDate && endDate) {
      // Date range
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    } else if (startDate) {
      query.date = { $gte: new Date(startDate) };
    } else if (endDate) {
      query.date = { $lte: new Date(endDate) };
    }

    // Filter by status
    if (status) query.status = status;

    // Apply role-based restrictions
    if (req.user.role === 'student') {
      // Students can only see their own attendance
      query.studentId = req.user.id;
    } else if (req.user.role === 'teacher') {
      // Teachers can only see attendance for courses they teach
      if (courseId) {
        const course = await Course.findById(courseId);
        if (!course || course.teacherId.toString() !== req.user.id) {
          return res.status(403).json({ message: 'Access denied' });
        }
      } else {
        // If no course ID specified, get all courses this teacher teaches
        const courses = await Course.find({ teacherId: req.user.id });
        const courseIds = courses.map(course => course._id);
        query.courseId = { $in: courseIds };
      }
    }

    // Build the query
    const attendanceQuery = Attendance.find(query)
      .populate('studentId', 'firstName lastName')
      .populate('courseId', 'name courseCode')
      .populate('recordedBy', 'firstName lastName')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ date: -1 });

    // Execute query
    const attendanceRecords = await attendanceQuery.exec();
    const total = await Attendance.countDocuments(query);

    res.json({
      attendance: attendanceRecords,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching attendance records:', error);
    res.status(500).json({ message: 'Server error fetching attendance records' });
  }
});

// Get a specific attendance record
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const attendance = await Attendance.findById(req.params.id)
      .populate('studentId', 'firstName lastName')
      .populate('courseId', 'name courseCode teacherId')
      .populate('recordedBy', 'firstName lastName');

    if (!attendance) {
      return res.status(404).json({ message: 'Attendance record not found' });
    }

    // Check access permissions
    if (req.user.role === 'student' && attendance.studentId._id.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    } else if (req.user.role === 'teacher') {
      const course = await Course.findById(attendance.courseId);
      if (!course || course.teacherId.toString() !== req.user.id) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    res.json(attendance);
  } catch (error) {
    console.error('Error fetching attendance record:', error);
    res.status(500).json({ message: 'Server error fetching attendance record' });
  }
});

// Update an attendance record
router.put('/:id', authenticateToken, authorizeRoles(['admin', 'teacher']), async (req, res) => {
  try {
    const { status, reason } = req.body;

    const attendance = await Attendance.findById(req.params.id);
    if (!attendance) {
      return res.status(404).json({ message: 'Attendance record not found' });
    }

    // Check permissions
    if (req.user.role === 'teacher') {
      const course = await Course.findById(attendance.courseId);
      if (!course || course.teacherId.toString() !== req.user.id) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    // Update fields
    if (status) attendance.status = status;
    if (reason !== undefined) attendance.reason = reason;
    attendance.recordedBy = req.user.id;
    attendance.recordedAt = Date.now();

    await attendance.save();

    res.json({
      message: 'Attendance record updated successfully',
      attendance
    });
  } catch (error) {
    console.error('Error updating attendance record:', error);
    res.status(500).json({ message: 'Server error updating attendance record' });
  }
});

// Delete an attendance record
router.delete('/:id', authenticateToken, authorizeRoles(['admin', 'teacher']), async (req, res) => {
  try {
    const attendance = await Attendance.findById(req.params.id);

    if (!attendance) {
      return res.status(404).json({ message: 'Attendance record not found' });
    }

    // Check permissions
    if (req.user.role === 'teacher') {
      const course = await Course.findById(attendance.courseId);
      if (!course || course.teacherId.toString() !== req.user.id) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    await Attendance.findByIdAndDelete(req.params.id);

    res.json({ message: 'Attendance record deleted successfully' });
  } catch (error) {
    console.error('Error deleting attendance record:', error);
    res.status(500).json({ message: 'Server error deleting attendance record' });
  }
});

// Bulk create/update attendance (useful for taking attendance for an entire class)
router.post('/bulk', authenticateToken, authorizeRoles(['admin', 'teacher']), async (req, res) => {
  try {
    const { courseId, date, records } = req.body;

    if (!courseId || !date || !records || !Array.isArray(records)) {
      return res.status(400).json({ message: 'Invalid request data' });
    }

    // Verify course exists
    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    // Check teacher permission
    if (req.user.role === 'teacher' && course.teacherId.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const results = [];
    const errors = [];

    // Process each attendance record
    for (const record of records) {
      try {
        const { studentId, status, reason } = record;

        // Verify student is enrolled in the course
        if (!course.students.includes(studentId)) {
          errors.push({ studentId, message: 'Student is not enrolled in this course' });
          continue;
        }

        // Upsert attendance record (update if exists, create if not)
        const updatedAttendance = await Attendance.findOneAndUpdate(
          { studentId, courseId, date: new Date(date) },
          {
            $set: {
              status,
              reason,
              recordedBy: req.user.id,
              recordedAt: Date.now()
            }
          },
          { new: true, upsert: true }
        );

        results.push(updatedAttendance);
      } catch (error) {
        errors.push({ studentId: record.studentId, message: error.message });
      }
    }

    res.status(200).json({
      message: 'Bulk attendance processed',
      results,
      errors
    });
  } catch (error) {
    console.error('Error processing bulk attendance:', error);
    res.status(500).json({ message: 'Server error processing bulk attendance' });
  }
});

module.exports = router;