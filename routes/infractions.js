// routes/infractions.js
const express = require('express');
const Infraction = require('../models/Infraction');
const User = require('../models/User');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

const router = express.Router();

// Create a new infraction (teachers and admin only)
router.post('/', authenticateToken, authorizeRoles(['admin', 'teacher']), async (req, res) => {
  try {
    const { studentId, type, description, severity, date, resolution } = req.body;

    // Verify student exists
    const student = await User.findOne({ _id: studentId, role: 'student' });
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    const newInfraction = new Infraction({
      studentId,
      type,
      description,
      severity: severity || 'minor',
      date: date || Date.now(),
      reportedBy: req.user.id,
      resolution,
      resolved: !!resolution
    });

    await newInfraction.save();

    res.status(201).json({
      message: 'Infraction recorded successfully',
      infraction: newInfraction
    });
  } catch (error) {
    console.error('Infraction creation error:', error);
    res.status(500).json({ message: 'Server error recording infraction' });
  }
});

// Get infractions with filtering
router.get('/', authenticateToken, async (req, res) => {
  try {
    const {
      studentId,
      type,
      severity,
      resolved,
      startDate,
      endDate,
      search,
      page = 1,
      limit = 20
    } = req.query;

    const skip = (page - 1) * limit;

    // Build query
    let query = {};

    // Filter by student
    if (studentId) query.studentId = studentId;

    // Filter by type
    if (type) query.type = type;

    // Filter by severity
    if (severity) query.severity = severity;

    // Filter by resolution status
    if (resolved !== undefined) query.resolved = resolved === 'true';

    // Filter by date range
    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    } else if (startDate) {
      query.date = { $gte: new Date(startDate) };
    } else if (endDate) {
      query.date = { $lte: new Date(endDate) };
    }

    // Search in description or resolution
    if (search) {
      query.$or = [
        { description: { $regex: search, $options: 'i' } },
        { resolution: { $regex: search, $options: 'i' } }
      ];
    }

    // Apply role-based restrictions
    if (req.user.role === 'student') {
      // Students can only see their own infractions
      query.studentId = req.user.id;
    }

    // Build the query
    const infractionsQuery = Infraction.find(query)
      .populate('studentId', 'firstName lastName')
      .populate('reportedBy', 'firstName lastName')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ date: -1 });

    // Execute query
    const infractions = await infractionsQuery.exec();
    const total = await Infraction.countDocuments(query);

    res.json({
      infractions,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching infractions:', error);
    res.status(500).json({ message: 'Server error fetching infractions' });
  }
});

// Get a specific infraction
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const infraction = await Infraction.findById(req.params.id)
      .populate('studentId', 'firstName lastName')
      .populate('reportedBy', 'firstName lastName');

    if (!infraction) {
      return res.status(404).json({ message: 'Infraction not found' });
    }

    // Check access permissions
    if (req.user.role === 'student' && infraction.studentId._id.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(infraction);
  } catch (error) {
    console.error('Error fetching infraction:', error);
    res.status(500).json({ message: 'Server error fetching infraction' });
  }
});

// Update an infraction
router.put('/:id', authenticateToken, authorizeRoles(['admin', 'teacher']), async (req, res) => {
  try {
    const { type, description, severity, resolution, resolved } = req.body;

    const infraction = await Infraction.findById(req.params.id);
    if (!infraction) {
      return res.status(404).json({ message: 'Infraction not found' });
    }

    // Update fields
    if (type) infraction.type = type;
    if (description) infraction.description = description;
    if (severity) infraction.severity = severity;
    if (resolution !== undefined) {
      infraction.resolution = resolution;
      if (resolution && resolution.trim() !== '') {
        infraction.resolved = true;
      }
    }
    if (resolved !== undefined) infraction.resolved = resolved;

    await infraction.save();

    res.json({
      message: 'Infraction updated successfully',
      infraction
    });
  } catch (error) {
    console.error('Error updating infraction:', error);
    res.status(500).json({ message: 'Server error updating infraction' });
  }
});

// Delete an infraction
router.delete('/:id', authenticateToken, authorizeRoles(['admin']), async (req, res) => {
  try {
    const infraction = await Infraction.findByIdAndDelete(req.params.id);

    if (!infraction) {
      return res.status(404).json({ message: 'Infraction not found' });
    }

    res.json({ message: 'Infraction deleted successfully' });
  } catch (error) {
    console.error('Error deleting infraction:', error);
    res.status(500).json({ message: 'Server error deleting infraction' });
  }
});

module.exports = router;