// routes/users.js
const express = require('express');
const User = require('../models/User');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

const router = express.Router();

const generatePassword = () => {
    const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()";
    let password = "";
    for (let i = 0; i < 8; i++) {
        const randomIndex = Math.floor(Math.random() * charset.length);
        password += charset[randomIndex];
    }
    return password;
};

// Create user (admin only)
router.post('/', authenticateToken, authorizeRoles(['admin']), async (req, res) => {
  try {
    const { firstName, lastName, email, role } = req.body;

    // Validate required fields
    if (!firstName || !lastName || !email || !role) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    // Generate username from first and last name (add unique suffix if needed)
    let username = `${firstName.toLowerCase()}${lastName.toLowerCase()}`;
    let userExists = await User.findOne({ username });

    // If username already exists, add a number suffix
    let counter = 1;
    while (userExists) {
      username = `${firstName.toLowerCase()}${lastName.toLowerCase()}${counter}`;
      userExists = await User.findOne({ username });
      counter++;
    }

    // Check for existing email
    const emailExists = await User.findOne({ email });
    if (emailExists) {
      return res.status(400).json({ message: 'Email already in use' });
    }

    // Generate password
    const password = generatePassword();

    // Create new user
    const newUser = new User({
      firstName,
      lastName,
      username,
      password, // Will be hashed by pre-save hook
      role,
      email
    });

    await newUser.save();

    // Log the credentials (in production, these should be sent via email)
    console.log('Generated credentials - Username:', username, 'Password:', password);

    res.status(201).json({
      message: 'User created successfully',
      user: {
        id: newUser._id,
        username: newUser.username,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        role: newUser.role,
        email: newUser.email,
        initialPassword: password // Include the initial password in the response
      }
    });
  } catch (error) {
    console.error('User creation error:', error);
    res.status(500).json({ message: 'Server error during user creation' });
  }
});


// Get all users with filtering (admin and teacher only)
router.get('/', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin or teacher
    if (req.user.role !== 'admin' && req.user.role !== 'teacher') {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Filter options
    const { search, sort, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    // Basic query - only get students
    let query = { role: 'student' };

    // Add search filter if provided
    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { username: { $regex: search, $options: 'i' } }
      ];
    }

    // Build the query
    const usersQuery = User.find(query)
      .select('-password')
      .skip(skip)
      .limit(parseInt(limit));

    // Add sorting if provided
    if (sort) {
      const [field, order] = sort.split(':');
      usersQuery.sort({ [field]: order === 'desc' ? -1 : 1 });
    } else {
      usersQuery.sort({ lastName: 1, firstName: 1 });
    }

    // Execute query
    const users = await usersQuery.exec();
    const total = await User.countDocuments(query);

    res.json({
      users,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ message: 'Server error fetching users' });
  }
});

// Get a specific user
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    // Only allow admins to view other user profiles
    if (req.user.role !== 'admin' && req.user.id !== req.params.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const user = await User.findById(req.params.id).select('-password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ message: 'Server error fetching user' });
  }
});

// Update a user
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    // Only allow users to update their own profile or admins to update any profile
    if (req.user.role !== 'admin' && req.user.id !== req.params.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { firstName, lastName, email, role } = req.body;

    // Prevent non-admins from changing roles
    if (req.user.role !== 'admin' && role) {
      return res.status(403).json({ message: 'Cannot update role' });
    }

    const updateData = {};
    if (firstName) updateData.firstName = firstName;
    if (lastName) updateData.lastName = lastName;
    if (email) updateData.email = email;
    if (role && req.user.role === 'admin') updateData.role = role;

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      message: 'User updated successfully',
      user
    });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ message: 'Server error updating user' });
  }
});

// Delete a user (admin only)
router.delete('/:id', authenticateToken, authorizeRoles(['admin']), async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ message: 'Server error deleting user' });
  }
});

module.exports = router;