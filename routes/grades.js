const express = require('express');
const Grade = require('../models/Grade');
const Course = require('../models/Course');
const User = require('../models/User');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

const router = express.Router();

// Create a new grade (admin or teacher)
router.post('/', authenticateToken, authorizeRoles(['admin', 'teacher']), async (req, res) => {
  console.log('entered post route');
  try {
    const { studentId, courseId, assignmentId, score, comment } = req.body;

    // Validate required fields
    if (!studentId || !courseId || !score) {
      return res.status(400).json({ message: 'Student ID, Course ID, and score are required' });
    }

    // Verify student exists and is a student
    const student = await User.findOne({ _id: studentId, role: 'student' });
    if (!student) {
      return res.status(400).json({ message: 'Invalid student ID' });
    }

    // Verify course exists
    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(400).json({ message: 'Invalid course ID' });
    }

    // Check if the student is enrolled in the course
    if (!course.students.includes(studentId)) {
      return res.status(400).json({ message: 'Student is not enrolled in this course' });
    }

    // For teachers, check if they are teaching this course
    if (req.user.role === 'teacher' && course.teacherId.toString() !== req.user.id) {
      return res.status(403).json({ message: 'You can only grade students in courses you teach' });
    }

    // Create new grade
    const newGrade = new Grade({
      studentId,
      courseId,
      score,
      gradedBy: req.user.id,
      gradedAt: new Date()
    });

    // Add optional fields if provided
    if (assignmentId) newGrade.assignmentId = assignmentId;
    if (comment) newGrade.comment = comment;

    await newGrade.save();

    res.status(201).json({
      message: 'Grade created successfully',
      grade: newGrade
    });
  } catch (error) {
    console.error('Grade creation error:', error);
    res.status(500).json({ message: 'Server error during grade creation' });
  }
});

// Get all grades (filtered by student, course, etc.)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { studentId, courseId, sort, page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    // Build query based on role and parameters
    let query = {};

    // Apply filters if provided
    if (studentId) query.studentId = studentId;
    if (courseId) query.courseId = courseId;

    // Role-based access control
    if (req.user.role === 'student') {
      // Students can only see their own grades
      query.studentId = req.user.id;
    } else if (req.user.role === 'teacher') {
      if (!courseId && !studentId) {
        // If no specific filters, get grades for courses taught by this teacher
        const teacherCourses = await Course.find({ teacherId: req.user.id }).select('_id');
        const courseIds = teacherCourses.map(course => course._id);
        query.courseId = { $in: courseIds };
      } else if (courseId) {
        // Verify teacher teaches this course
        const course = await Course.findById(courseId);
        if (!course || course.teacherId.toString() !== req.user.id) {
          return res.status(403).json({ message: 'Access denied to this course' });
        }
      }
    }
    // Admins can see all grades with any filter

    // Build the query
    const gradesQuery = Grade.find(query)
      .skip(skip)
      .limit(parseInt(limit))
      .populate('studentId', 'firstName lastName username')
      .populate('courseId', 'name courseCode')
      .populate('gradedBy', 'firstName lastName');

    // Add sorting if provided
    if (sort) {
      const [field, order] = sort.split(':');
      gradesQuery.sort({ [field]: order === 'desc' ? -1 : 1 });
    } else {
      gradesQuery.sort({ gradedAt: -1 }); // Default newest first
    }

    // Execute query
    const grades = await gradesQuery.exec();
    const total = await Grade.countDocuments(query);

    res.json({
      grades,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching grades:', error);
    res.status(500).json({ message: 'Server error fetching grades' });
  }
});

// Get grades for a specific student
router.get('/student/:studentId', authenticateToken, async (req, res) => {
  try {
    const studentId = req.params.studentId;

    // Check permissions
    if (req.user.role === 'student' && req.user.id !== studentId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // For teachers, verify they teach at least one course this student is enrolled in
    if (req.user.role === 'teacher') {
      const teacherCourses = await Course.find({ teacherId: req.user.id }).select('_id');
      const teacherCourseIds = teacherCourses.map(course => course._id);

      const studentEnrollment = await Course.findOne({
        _id: { $in: teacherCourseIds },
        students: studentId
      });

      if (!studentEnrollment) {
        return res.status(403).json({ message: 'This student is not enrolled in any of your courses' });
      }
    }

    // Get courses this student is enrolled in
    const enrolledCourses = await Course.find({ students: studentId })
      .select('_id name courseCode')
      .lean();

    // Get all grades for this student
    const grades = await Grade.find({ studentId })
      .populate('courseId', 'name courseCode')
      .populate('assignmentId', 'title dueDate')
      .populate('gradedBy', 'firstName lastName')
      .sort({ gradedAt: -1 });

    // Organize grades by course
    const gradesByCourseName = {};

    // Initialize with all enrolled courses (even those without grades)
    enrolledCourses.forEach(course => {
      gradesByCourseName[course.name] = {
        courseId: course._id,
        courseCode: course.courseCode,
        grades: []
      };
    });

    // Add grades to their respective courses
    grades.forEach(grade => {
      if (grade.courseId && grade.courseId.name) {
        if (!gradesByCourseName[grade.courseId.name]) {
          gradesByCourseName[grade.courseId.name] = {
            courseId: grade.courseId._id,
            courseCode: grade.courseId.courseCode,
            grades: []
          };
        }
        gradesByCourseName[grade.courseId.name].grades.push({
          _id: grade._id,
          score: grade.score,
          comment: grade.comment,
          assignmentTitle: grade.assignmentId?.title || 'General Assessment',
          gradedBy: grade.gradedBy ? `${grade.gradedBy.firstName} ${grade.gradedBy.lastName}` : 'System',
          gradedAt: grade.gradedAt
        });
      }
    });

    res.json({
      studentId,
      courses: gradesByCourseName
    });
  } catch (error) {
    console.error('Error fetching student grades:', error);
    res.status(500).json({ message: 'Server error fetching student grades' });
  }
});

// Get grades for a specific course
router.get('/course/:courseId', authenticateToken, async (req, res) => {
  try {
    const courseId = req.params.courseId;

    // Verify course exists
    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    // Check permissions
    if (req.user.role === 'student') {
      // Students can only see course grade summary if enrolled
      if (!course.students.includes(req.user.id)) {
        return res.status(403).json({ message: 'You are not enrolled in this course' });
      }
    } else if (req.user.role === 'teacher' && course.teacherId.toString() !== req.user.id) {
      // Teachers can only see grades for courses they teach
      return res.status(403).json({ message: 'You do not teach this course' });
    }

    // Get all grades for this course
    const grades = await Grade.find({ courseId })
      .populate('studentId', 'firstName lastName username')
      .populate('assignmentId', 'title')
      .sort({ 'studentId.lastName': 1 });

    // For students, only return their own grades
    if (req.user.role === 'student') {
      const studentGrades = grades.filter(grade =>
        grade.studentId._id.toString() === req.user.id
      );

      return res.json({
        courseId,
        courseName: course.name,
        courseCode: course.courseCode,
        grades: studentGrades
      });
    }

    // For teachers and admins, organize grades by student
    const studentMap = {};

    // Get all students enrolled in the course
    course.students.forEach(studentId => {
      studentMap[studentId.toString()] = {
        studentId: studentId,
        grades: []
      };
    });

    // Add student data
    for (const grade of grades) {
      if (grade.studentId && studentMap[grade.studentId._id.toString()]) {
        const studentId = grade.studentId._id.toString();

        // Initialize student name if not already set
        if (!studentMap[studentId].name) {
          studentMap[studentId].name = `${grade.studentId.firstName} ${grade.studentId.lastName}`;
          studentMap[studentId].username = grade.studentId.username;
        }

        studentMap[studentId].grades.push({
          _id: grade._id,
          score: grade.score,
          comment: grade.comment,
          assignmentTitle: grade.assignmentId?.title || 'General Assessment',
          gradedAt: grade.gradedAt
        });
      }
    }

    res.json({
      courseId,
      courseName: course.name,
      courseCode: course.courseCode,
      students: Object.values(studentMap)
    });
  } catch (error) {
    console.error('Error fetching course grades:', error);
    res.status(500).json({ message: 'Server error fetching course grades' });
  }
});

// Get a specific grade
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const grade = await Grade.findById(req.params.id)
      .populate('studentId', 'firstName lastName username')
      .populate('courseId', 'name courseCode teacherId')
      .populate('assignmentId', 'title description dueDate')
      .populate('gradedBy', 'firstName lastName');

    if (!grade) {
      return res.status(404).json({ message: 'Grade not found' });
    }

    // Check permissions
    if (req.user.role === 'student' && grade.studentId._id.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    } else if (req.user.role === 'teacher' && grade.courseId.teacherId.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(grade);
  } catch (error) {
    console.error('Error fetching grade:', error);
    res.status(500).json({ message: 'Server error fetching grade' });
  }
});

// Update a grade (admin or teacher)
router.put('/:id', authenticateToken, authorizeRoles(['admin', 'teacher']), async (req, res) => {
  try {
    const { score, comment } = req.body;

    const grade = await Grade.findById(req.params.id)
      .populate('courseId', 'teacherId');

    if (!grade) {
      return res.status(404).json({ message: 'Grade not found' });
    }

    // Check permissions - teachers can only update grades for their courses
    if (req.user.role === 'teacher' &&
        grade.courseId.teacherId.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Update fields
    if (score !== undefined) grade.score = score;
    if (comment !== undefined) grade.comment = comment;

    // Update grade timestamp and grader
    grade.gradedAt = new Date();
    grade.gradedBy = req.user.id;

    await grade.save();

    res.json({
      message: 'Grade updated successfully',
      grade
    });
  } catch (error) {
    console.error('Error updating grade:', error);
    res.status(500).json({ message: 'Server error updating grade' });
  }
});

// Delete a grade (admin or teacher)
router.delete('/:id', authenticateToken, authorizeRoles(['admin', 'teacher']), async (req, res) => {
  try {
    const grade = await Grade.findById(req.params.id)
      .populate('courseId', 'teacherId');

    if (!grade) {
      return res.status(404).json({ message: 'Grade not found' });
    }

    // Check permissions - teachers can only delete grades for their courses
    if (req.user.role === 'teacher' &&
        grade.courseId.teacherId.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    await Grade.findByIdAndDelete(req.params.id);

    res.json({ message: 'Grade deleted successfully' });
  } catch (error) {
    console.error('Error deleting grade:', error);
    res.status(500).json({ message: 'Server error deleting grade' });
  }
});

// Get grade statistics for a course
router.get('/stats/course/:courseId', authenticateToken, async (req, res) => {
  try {
    const courseId = req.params.courseId;

    // Verify course exists
    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    // Check permissions
    if (req.user.role === 'student') {
      // Students can only see stats for courses they're enrolled in
      if (!course.students.includes(req.user.id)) {
        return res.status(403).json({ message: 'You are not enrolled in this course' });
      }
    } else if (req.user.role === 'teacher' && course.teacherId.toString() !== req.user.id) {
      // Teachers can only see stats for courses they teach
      return res.status(403).json({ message: 'You do not teach this course' });
    }

    // Get all grades for this course
    const grades = await Grade.find({ courseId }).select('score');

    if (grades.length === 0) {
      return res.json({
        courseId,
        courseName: course.name,
        stats: {
          count: 0,
          average: null,
          highest: null,
          lowest: null,
          median: null
        }
      });
    }

    // Extract scores
    const scores = grades.map(grade => grade.score);

    // Calculate statistics
    const count = scores.length;
    const sum = scores.reduce((a, b) => a + b, 0);
    const average = sum / count;
    const highest = Math.max(...scores);
    const lowest = Math.min(...scores);

    // Calculate median
    const sortedScores = [...scores].sort((a, b) => a - b);
    const midIndex = Math.floor(sortedScores.length / 2);
    const median = sortedScores.length % 2 === 0
      ? (sortedScores[midIndex - 1] + sortedScores[midIndex]) / 2
      : sortedScores[midIndex];

    res.json({
      courseId,
      courseName: course.name,
      stats: {
        count,
        average,
        highest,
        lowest,
        median
      }
    });
  } catch (error) {
    console.error('Error fetching grade statistics:', error);
    res.status(500).json({ message: 'Server error fetching grade statistics' });
  }
});

module.exports = router;