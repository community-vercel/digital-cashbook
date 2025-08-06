// backend/controllers/authController.js
const User = require('../models/User');
const Shop = require('../models/Shop');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

// Fixed register function in authController.js
exports.register = async (req, res) => {
  try {
    const { username, password, role, shopId } = req.body;
    console.log('Received register payload:', { username, role, shopId });
    console.log('Request user (superadmin) info:', { 
      userId: req.user?.userId, 
      role: req.user?.role, 
      tokenShopId: req.user?.shopId 
    });

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    if (role && !['user', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be "user" or "admin"' });
    }

    if (shopId && !mongoose.Types.ObjectId.isValid(shopId)) {
      console.log('Invalid shopId:', shopId);
      return res.status(400).json({ error: 'Invalid shopId' });
    }

    if (shopId) {
      const shop = await Shop.findById(shopId);
      if (!shop) {
        console.log('Shop not found for shopId:', shopId);
        return res.status(404).json({ error: 'Shop not found' });
      }
    }

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      console.log('Username already exists:', username);
      return res.status(400).json({ error: 'Username already exists' });
    }

    // DON'T hash the password here - let the model middleware handle it
    // const hashedPassword = await bcrypt.hash(password, 10); // REMOVE THIS LINE
    
    // Use the shopId from the request body (selectedShopId from frontend)
    // NOT the shopId from the superadmin's token
    const userData = {
      username,
      password, // Use plain password - model will hash it
      role: role || 'user',
      shopId: shopId || null, // Use the shopId from request, not from token
    };

    const user = await User.create(userData);

    console.log('Created user:', { 
      _id: user._id, 
      username: user.username, 
      role: user.role, 
      shopId: user.shopId,
      requestedShopId: shopId
    });
    
    res.status(201).json({
      message: 'User created successfully',
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

// Updated login function in authController.js
exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await User.findOne({ username });
    console.log('Login attempt for user:', username);
    console.log('User found:', user ? 'Yes' : 'No');
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Debug password comparison
    const isPasswordValid = await bcrypt.compare(password, user.password);
    console.log('Password comparison result:', isPasswordValid);
    console.log('Provided password length:', password.length);
    console.log('Stored hash:', user.password.substring(0, 20) + '...');

    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user._id, role: user.role, shopId: user.shopId || null },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    console.log('User logged in successfully:', { 
      userId: user._id, 
      role: user.role, 
      shopId: user.shopId 
    });
    
    res.json({
      token,
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
exports.validateToken = (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.error('No token provided or invalid Authorization header:', authHeader);
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.replace('Bearer ', '');
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('Validated token:', { userId: decoded.userId, role: decoded.role, shopId: decoded.shopId });
    res.status(200).json({
      message: 'Token is valid',
      user: { id: decoded.userId, role: decoded.role, shopId: decoded.shopId },
    });
  } catch (error) {
    console.error('Token validation failed:', error.message);
    res.status(401).json({ error: 'Invalid or expired token', details: error.message });
  }
};