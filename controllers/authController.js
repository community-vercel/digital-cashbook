// backend/controllers/authController.js
const User = require('../models/User');
const Shop = require('../models/Shop');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const mongoose = require('mongoose');

exports.register = async (req, res) => {
  try {
    const { username, password, role, shopId } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    if (role && !['user', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be "user" or "admin"' });
    }

    if (shopId && !mongoose.Types.ObjectId.isValid(shopId)) {
      return res.status(400).json({ error: 'Invalid shopId' });
    }

    if (shopId) {
      const shop = await Shop.findById(shopId);
      if (!shop) {
        return res.status(404).json({ error: 'Shop not found' });
      }
    }

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const user = await User.create({
      username,
      password,
      role: role || 'user',
      shopId: shopId || null,
    });

    const accessToken = jwt.sign(
      { userId: user._id, role: user.role, shopId: user.shopId || null },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    const refreshToken = jwt.sign(
      { userId: user._id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: '7d' }
    );

    await User.findByIdAndUpdate(user._id, { refreshToken });

    res.status(201).json({
      message: 'User created successfully',
      accessToken,
      refreshToken,
      user: {
        _id: user._id,
        username: user.username,
        role: user.role,
        shopId: user.shopId,
      },
    });
  } catch (error) {
    console.error('Register user failed:', error);
    res.status(500).json({ error: 'Server error: Failed to register user', details: error.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const accessToken = jwt.sign(
      { userId: user._id, role: user.role, shopId: user.shopId || null },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    const refreshToken = jwt.sign(
      { userId: user._id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: '7d' }
    );

    await User.findByIdAndUpdate(user._id, { refreshToken });

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user._id,
        role: user.role,
        shopId: user.shopId,
      },
    });
  } catch (error) {
    console.error('Login failed:', error);
    res.status(500).json({ error: 'Server error: Failed to login', details: error.message });
  }
};

exports.validateToken = async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.replace('Bearer ', '');
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.status(200).json({
      message: 'Token is valid',
      user: { id: decoded.userId, role: decoded.role, shopId: decoded.shopId },
    });
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired token', details: error.message });
  }
};

exports.refreshToken = async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(401).json({ error: 'Refresh token required' });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(decoded.userId);

    if (!user || user.refreshToken !== refreshToken) {
      return res.status(403).json({ error: 'Invalid refresh token' });
    }

    const newAccessToken = jwt.sign(
      { userId: user._id, role: user.role, shopId: user.shopId || null },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    const newRefreshToken = jwt.sign(
      { userId: user._id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: '7d' }
    );

    await User.findByIdAndUpdate(user._id, { refreshToken: newRefreshToken });

    res.json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    });
  } catch (error) {
    console.error('Refresh token failed:', error);
    res.status(403).json({ error: 'Invalid or expired refresh token', details: error.message });
  }
};

exports.logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' });
    }

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(decoded.userId);

    if (!user || user.refreshToken !== refreshToken) {
      return res.status(403).json({ error: 'Invalid refresh token' });
    }

    // Clear refresh token from user record
    await User.findByIdAndUpdate(user._id, { refreshToken: null });

    res.status(200).json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout failed:', error);
    res.status(500).json({ error: 'Server error: Failed to logout', details: error.message });
  }
};