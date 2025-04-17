const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
require('dotenv').config();
const User = require('./models/User'); // Adjust path as needed

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const courseRoutes = require('./routes/courses');
const assignmentRoutes = require('./routes/assignments');
const gradeRoutes = require('./routes/grades');
const attendanceRoutes = require('./routes/attendance');
const infractionRoutes = require('./routes/infractions');

// Initialize express app
const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(morgan('dev'));

const newUser = {
  username: 'admin',
  password: 'admin', // Will be hashed by the pre-save hook
  role: 'admin', // Options: 'admin', 'teacher', 'student'
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User'
};
// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// Function to create a user
async function createUser() {
  try {
    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [
        { username: newUser.username },
        { email: newUser.email }
      ]
    });

    if (existingUser) {
      console.log('User already exists with this username or email');
      return;
    }

    // Create and save the new user
    const user = new User(newUser);
    await user.save();

    console.log('User created successfully:', {
      id: user._id,
      username: user.username,
      role: user.role,
      email: user.email,
      name: `${user.firstName} ${user.lastName}`
    });
  } catch (error) {
    console.error('Error creating user:', error);
  } finally {
    // Close the connection when finished
    mongoose.connection.close();
  }
}

// Run the function

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/grades', gradeRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/infractions', infractionRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Server error', error: err.message });
});

// Define port
const PORT = process.env.PORT || 5000;

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  //createUser();
});

module.exports = app;