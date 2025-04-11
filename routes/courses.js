// routes/courses.js
const express = require('express');
const Course = require('../models/Course');
const User = require('../models/User');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

const router = express.Router();

// Create a new course (admin or teacher)
router.post('/', authenticateToken, authorizeRoles(['admin', 'teacher']), async (req, res) => {
  try {
    const { name, courseCode, description, teacherId } = req.body;

    // Check if the course code already exists
    const existingCourse = await Course.findOne({ courseCode });
    if (existingCourse) {
      return res.status(400).json({ message: 'Course with this code already exists' });
    }

    // If teacherId provided, verify it's a valid teacher
    if (teacherId) {
      const teacher = await User.findOne({ _id: teacherId, role: 'teacher' });
      if (!teacher) {
        return res.status(400).json({ message: 'Invalid teacher ID' });
      }
    }

    const newCourse = new Course({
      name,
      courseCode,
      description,
      teacherId: teacherId || req.user.id, // Default to current user if teacher
    });

    await newCourse.save();

    res.status(201).json({
      message: 'Course created successfully',
      course: newCourse
    });
  } catch (error) {
    console.error('Course creation error:', error);
    res.status(500).json({ message: 'Server error creating course' });
  }
});

// Get all courses with filtering
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { teacherId, search, active, sort, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    // Build query
    let query = {};

    // Filter by teacher
    if (teacherId) {
      query.teacherId = teacherId;
    }


    // Search by name or code
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { courseCode: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    // Role-based filtering
    if (req.user.role === 'student') {
      // Students can only see courses they're enrolled in
      query.students = req.user.id;
    } else if (req.user.role === 'teacher' && !teacherId) {
      // Teachers default to seeing only their courses
      query.teacherId = req.user.id;
    }
    // Admins can see all courses

    // Build the query
    const coursesQuery = Course.find(query)
      .skip(skip)
      .limit(parseInt(limit));

    // Add sorting
    if (sort) {
      const [field, order] = sort.split(':');
      coursesQuery.sort({ [field]: order === 'desc' ? -1 : 1 });
    } else {
      coursesQuery.sort({ name: 1 });
    }

    // Add population for teacher data
    coursesQuery.populate('teacherId', 'firstName lastName');

    // Execute query
    const courses = await coursesQuery.exec();
    const total = await Course.countDocuments(query);

    res.json({
      courses,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching courses:', error);
    res.status(500).json({ message: 'Server error fetching courses' });
  }
});

// Get a specific course with student list
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const course = await Course.findById(req.params.id)
      .populate('teacherId', 'firstName lastName email')
      .populate('students', 'firstName lastName email');

    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    // Check access permissions
    if (req.user.role === 'student' && !course.students.some(s => s._id.toString() === req.user.id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (req.user.role === 'teacher' && course.teacherId._id.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(course);
  } catch (error) {
    console.error('Error fetching course:', error);
    res.status(500).json({ message: 'Server error fetching course' });
  }
});

// Update a course
router.put('/:id', authenticateToken, authorizeRoles(['admin', 'teacher']), async (req, res) => {
  try {
    const { name, description, teacherId } = req.body;

    const course = await Course.findById(req.params.id);

    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    // Check permissions - teachers can only edit their own courses
    if (req.user.role === 'teacher' && course.teacherId.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Update fields
    if (name) course.name = name;
    if (description) course.description = description;
    if (teacherId && req.user.role === 'admin') {
      const teacher = await User.findOne({ _id: teacherId, role: 'teacher' });
      if (!teacher) {
        return res.status(400).json({ message: 'Invalid teacher ID' });
      }
      course.teacherId = teacherId;
    }

    await course.save();

    res.json({
      message: 'Course updated successfully',
      course
    });
  } catch (error) {
    console.error('Error updating course:', error);
    res.status(500).json({ message: 'Server error updating course' });
  }
});

// Delete a course (admin only)
router.delete('/:id', authenticateToken, authorizeRoles(['admin']), async (req, res) => {
  try {
    const course = await Course.findByIdAndDelete(req.params.id);

    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    res.json({ message: 'Course deleted successfully' });
  } catch (error) {
    console.error('Error deleting course:', error);
    res.status(500).json({ message: 'Server error deleting course' });
  }
});

// Add student to course
router.post('/:id/enroll', authenticateToken, authorizeRoles(['admin', 'teacher']), async (req, res) => {
  try {
    const { studentId } = req.body;

    const course = await Course.findById(req.params.id);
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    // Check permissions
    if (req.user.role === 'teacher' && course.teacherId.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Verify student exists
    const student = await User.findOne({ _id: studentId, role: 'student' });
    if (!student) {
      return res.status(400).json({ message: 'Invalid student ID' });
    }

    // Check if student already enrolled
    if (course.students.includes(studentId)) {
      return res.status(400).json({ message: 'Student already enrolled in this course' });
    }

    // Add student to course
    course.students.push(studentId);
    await course.save();

    res.json({
      message: 'Student added to course successfully',
      course
    });
  } catch (error) {
    console.error('Error adding student to course:', error);
    res.status(500).json({ message: 'Server error adding student to course' });
  }
});

// Remove student from course
router.delete('/:id/students/:studentId', authenticateToken, authorizeRoles(['admin', 'teacher']), async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    // Check permissions
    if (req.user.role === 'teacher' && course.teacherId.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Remove student from course
    course.students = course.students.filter(id => id.toString() !== req.params.studentId);
    await course.save();

    res.json({
      message: 'Student removed from course successfully',
      course
    });
  } catch (error) {
    console.error('Error removing student from course:', error);
    res.status(500).json({ message: 'Server error removing student from course' });
  }
});

module.exports = router;