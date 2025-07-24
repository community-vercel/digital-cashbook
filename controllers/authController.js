const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

exports.register = async (req, res) => {
  try {
    const { username, password, role } = req.body;
    const user = new User({ username, password, role });
    await user.save();
    const token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.status(201).json({ token, user: { id: user._id, username, role } });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.json({ token, user: { id: user._id, username, role: user.role } });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.validateToken = (req, res, next) => {
   const token = req.headers.authorization?.split(' ')[1]; // Extract token from Bearer header

  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }

  try {
    // Verify token (replace 'your_jwt_secret' with your actual secret)
    jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret');
    res.status(200).json({ message: 'Token is valid' });
  } catch (error) {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
}
