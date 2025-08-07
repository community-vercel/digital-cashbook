// routes/shops.js
const express = require('express');
const router = express.Router();
const Shop = require('../models/Shop');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const verifySuperadmin = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'superadmin') return res.status(403).json({ error: 'Superadmin access required' });
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

router.post('/', verifySuperadmin, async (req, res) => {
  try {
    const { name, location } = req.body;
    const shop = new Shop({ name, location });
    await shop.save();
    res.status(201).json({ shop });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const shops = await Shop.find();
    res.json(shops);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/assign-user', verifySuperadmin, async (req, res) => {
  try {
    const { userId, shopId } = req.body;
    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(shopId)) {
      return res.status(400).json({ error: 'Invalid userId or shopId' });
    }
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const shop = await Shop.findById(shopId);
    if (!shop) return res.status(404).json({ error: 'Shop not found' });
    user.shopId = shopId;
    await user.save();
    res.json({ message: 'User assigned to shop', user });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;