// backend/routes/users.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Shop = require('../models/Shop');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const verifySuperadmin = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.error('No token provided or invalid Authorization header:', authHeader);
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.replace('Bearer ', '');
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('Decoded token:', { userId: decoded.userId, role: decoded.role, shopId: decoded.shopId });
    if (decoded.role !== 'superadmin') {
      console.error('Superadmin access required, user role:', decoded.role);
      return res.status(403).json({ error: 'Superadmin access required' });
    }
    req.user = decoded;
    next();
  } catch (error) {
    console.error('Invalid token error:', error.message);
    res.status(401).json({ error: 'Invalid token', details: error.message });
  }
};

router.get('/', verifySuperadmin, async (req, res) => {
  try {
    const { shopId } = req.query;
    console.log('Fetching users with shopId from query:', shopId);
    const query = shopId && mongoose.Types.ObjectId.isValid(shopId) ? { shopId } : {};
    const users = await User.find(query).select('-password').populate('shopId', 'name');
    res.json(users);
  } catch (error) {
    console.error('Get users failed:', error);
    res.status(500).json({ error: 'Server error: Failed to fetch users', details: error.message });
  }
});

router.put('/:id', verifySuperadmin, async (req, res) => {
  try {
    const { username, role, shopId } = req.body;
    console.log('Received update payload:', { username, role, shopId });
    console.log('Request params id:', req.params.id);

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

    // Use the shopId from the request body (selectedShopId from frontend)
    // NOT the shopId from the token
    const updateData = {
      username,
      role,
      shopId: shopId || null
    };

    const user = await User.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    ).select('-password');

    if (!user) return res.status(404).json({ error: 'User not found' });
    
    console.log('Updated user:', { 
      _id: user._id, 
      username: user.username, 
      role: user.role, 
      shopId: user.shopId,
      requestedShopId: shopId
    });
    
    res.json(user);
  } catch (error) {
    console.error('Update user failed:', error);
    res.status(400).json({ error: 'Server error: Failed to update user', details: error.message });
  }
});

router.delete('/:id', verifySuperadmin, async (req, res) => {
  try {
    if (req.user.userId === req.params.id) {
      return res.status(403).json({ error: 'Cannot delete your own account' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.role === 'superadmin') {
      return res.status(403).json({ error: 'Cannot delete a superadmin user' });
    }

    await User.findByIdAndDelete(req.params.id);
    console.log('Deleted user with id:', req.params.id);
    res.json({ message: 'User deleted' });
  } catch (error) {
    console.error('Delete user failed:', error);
    res.status(500).json({ error: 'Server error: Failed to delete user', details: error.message });
  }
});

module.exports = router;