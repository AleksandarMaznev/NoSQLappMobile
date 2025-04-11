// routes/assignments.js
const express = require('express');
const Assignment = require('../models/Assignment');
const Course = require('../models/Course');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

const router = express.Router();

// Create a new assignment
router.post('/', authenticateToken, authorizeRoles(['admin', 'teacher']), async (req, res) => {
  try {
    const { title, description, courseId, dueDate, totalPoints } = req.body;

    // Verify course exists and user has access
    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    // Check if teacher has access to this course
    if (req.user.role === 'teacher' && course.teacherId.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const newAssignment = new Assignment({
      title,
      description,
      courseId,
      dueDate,
      totalPoints,
      createdBy: req.user.id
    });

    await newAssignment.save();

    res.status(201).json({
      message: 'Assignment created successfully',
      assignment: newAssignment
    });
  } catch (error) {
    console.error('Assignment creation error:', error);
    res.status(500).json({ message: 'Server error creating assignment' });
  }
});

// Get assignments with filtering
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { courseId, upcoming, past, search, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    // Build query
    let query = {};

    // Filter by course
    if (courseId) {
      query.courseId = courseId;

      // If student, verify enrollment
      if (req.user.role === 'student') {
        const course = await Course.findById(courseId);
        if (!course || !course.students.includes(req.user.id)) {
          return res.status(403).json({ message: 'Access denied' });
        }
      }
    } else {
      // If no courseId specified, filter by user access
      if (req.user.role === 'student') {
        // Get courses the student is enrolled in
        const courses = await Course.find({ students: req.user.id });
        const courseIds = courses.map(course => course._id);
        query.courseId = { $in: courseIds };
      } else if (req.user.role === 'teacher') {
        // Get courses the teacher teaches
        const courses = await Course.find({ teacherId: req.user.id });
        const courseIds = courses.map(course => course._id);
        query.courseId = { $in: courseIds };
      }
    }

    // Filter by due date
    const now = new Date();
    if (upcoming === 'true') {
      query.dueDate = { $gte: now };
    } else if (past === 'true') {
      query.dueDate = { $lt: now };
    }

    // Search by title or description
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    // Build the query
    const assignmentsQuery = Assignment.find(query)
      .populate('courseId', 'name courseCode')
      .populate('createdBy', 'firstName lastName')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ dueDate: 1 });

    // Execute query
    const assignments = await assignmentsQuery.exec();
    const total = await Assignment.countDocuments(query);

    res.json({
      assignments,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching assignments:', error);
    res.status(500).json({ message: 'Server error fetching assignments' });
  }
});

// Get a specific assignment
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.id)
      .populate('courseId', 'name courseCode teacherId')
      .populate('createdBy', 'firstName lastName');

    if (!assignment) {
      return res.status(404).json({ message: 'Assignment not found' });
    }

    // Check access permissions
    if (req.user.role === 'student') {
      const course = await Course.findById(assignment.courseId);
      if (!course || !course.students.includes(req.user.id)) {
        return res.status(403).json({ message: 'Access denied' });
      }
    } else if (req.user.role === 'teacher') {
      const course = await Course.findById(assignment.courseId);
      if (!course || course.teacherId.toString() !== req.user.id) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    res.json(assignment);
  } catch (error) {
    console.error('Error fetching assignment:', error);
    res.status(500).json({ message: 'Server error fetching assignment' });
  }
});

// Update an assignment
router.put('/:id', authenticateToken, authorizeRoles(['admin', 'teacher']), async (req, res) => {
  try {
    const { title, description, dueDate, totalPoints } = req.body;

    const assignment = await Assignment.findById(req.params.id);
    if (!assignment) {
      return res.status(404).json({ message: 'Assignment not found' });
    }

    // Check permissions
    if (req.user.role === 'teacher') {
      const course = await Course.findById(assignment.courseId);
      if (!course || course.teacherId.toString() !== req.user.id) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    // Update fields
    if (title) assignment.title = title;
    if (description) assignment.description = description;
    if (dueDate) assignment.dueDate = dueDate;
    if (totalPoints) assignment.totalPoints = totalPoints;

    await assignment.save();

    res.json({
      message: 'Assignment updated successfully',
      assignment
    });
  } catch (error) {
    console.error('Error updating assignment:', error);
    res.status(500).json({ message: 'Server error updating assignment' });
  }
});

// Delete an assignment
router.delete('/:id', authenticateToken, authorizeRoles(['admin', 'teacher']), async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.id);

    if (!assignment) {
      return res.status(404).json({ message: 'Assignment not found' });
    }

    // Check permissions
    if (req.user.role === 'teacher') {
      const course = await Course.findById(assignment.courseId);
      if (!course || course.teacherId.toString() !== req.user.id) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    await Assignment.findByIdAndDelete(req.params.id);

    res.json({ message: 'Assignment deleted successfully' });
  } catch (error) {
    console.error('Error deleting assignment:', error);
    res.status(500).json({ message: 'Server error deleting assignment' });
  }
});

module.exports = router;