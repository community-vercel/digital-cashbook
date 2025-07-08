const express = require('express');
const jwt = require('jsonwebtoken');
const Item = require('../models/Item');
const router = express.Router();

// Middleware to verify JWT
const authMiddleware = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ message: 'No token, authorization denied' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Token is not valid' });
  }
};

// Get all items
router.get('/', authMiddleware, async (req, res) => {
  const { search, page = 1, limit = 10 } = req.query;
  const query = { userId: req.user.userId };

  // Add search functionality
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { category: { $regex: search, $options: 'i' } },
      { shelf: { $regex: search, $options: 'i' } },
    ];
  }

  try {
    const items = await Item.find(query)
      .skip((page - 1) * limit)
      .limit(Number(limit));
    const total = await Item.countDocuments(query);
    res.json({ items, total });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Add item (with or without barcode)
router.post('/', authMiddleware, async (req, res) => {
  const { name, quantity, price, barcode, category, shelf, minStock, maxStock } = req.body;
  try {
    const item = new Item({
      name,
      quantity,
      price,
      barcode: barcode || null, // Allow null barcode
      category,
      shelf: shelf || null, // Allow null shelf
      minStock,
      maxStock,
      userId: req.user.userId,
    });
    await item.save();
    res.json({ message: 'Item added successfully', item });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Update item
router.put('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { name, quantity, price, barcode, category, shelf, minStock, maxStock } = req.body;
  try {
    const item = await Item.findOneAndUpdate(
      { _id: id, userId: req.user.userId },
      { name, quantity, price, barcode, category, shelf, minStock, maxStock },
      { new: true }
    );
    if (!item) return res.status(404).json({ message: 'Item not found' });
    res.json({ message: 'Item updated successfully', item });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});
//get itm
router.get('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const item = await Item.findOne(
      { _id: id }
   
    );
    if (!item) return res.status(404).json({ message: 'Item not found' });
    res.json(item); 
 } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete item
router.delete('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const item = await Item.findOneAndDelete({ _id: id, userId: req.user.userId });
    if (!item) return res.status(404).json({ message: 'Item not found' });
    res.json({ message: 'Item deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Scan barcode
router.get('/scan/:barcode', authMiddleware, async (req, res) => {
  const { barcode } = req.params;
  try {
    const item = await Item.findOne({ barcode, userId: req.user.userId });
    if (!item) return res.status(404).json({ message: 'Item not found' });
    res.json(item);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;