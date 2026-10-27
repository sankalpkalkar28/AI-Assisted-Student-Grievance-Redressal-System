const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const signToken = (user) =>
  jwt.sign(
    {
      userId: user._id,
      role: user.role,
      department: user.department ? user.department._id || user.department : null,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

const publicUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  department: user.department
    ? { id: user.department._id || user.department, name: user.department.name }
    : null,
});

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * POST /api/auth/register
 * Creates a STUDENT account (role can never be chosen by the client).
 */
router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { name, email, password } = req.body;

    if (![name, email, password].every(isNonEmptyString)) {
      return res.status(400).json({ message: 'Name, email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    if (await User.exists({ email: normalizedEmail })) {
      return res.status(409).json({ message: 'An account with this email already exists' });
    }

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password, // hashed by the pre-save hook in User.js
      role: 'student',
    });

    return res.status(201).json({ token: signToken(user), user: publicUser(user) });
  })
);

/**
 * POST /api/auth/login
 * Verifies the password with bcrypt and returns a JWT { userId, role, department }.
 */
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    // typeof checks also block NoSQL-injection payloads like { "email": { "$gt": "" } }
    if (!isNonEmptyString(email) || !isNonEmptyString(password)) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() })
      .select('+password')
      .populate('department', 'name');

    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    return res.json({ token: signToken(user), user: publicUser(user) });
  })
);

module.exports = router;