const express = require('express');
const jwt = require('jsonwebtoken');
const Item = require('../models/Item');
const Product = require('../models/Product');
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

// Get all items with search and pagination
router.get('/', authMiddleware, async (req, res) => {
  const { search, page = 1, limit = 10 } = req.query;
  const query = { userId: req.user.userId };

  if (search) {
    const productQuery = {
      $or: [
        { name: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } },
      ],
    };
    const products = await Product.find(productQuery).select('_id');
    query.productId = { $in: products.map((p) => p._id) };
  }

  try {
    const items = await Item.find(query)
      .populate({
        path: 'productId',
        populate: { path: 'colorId', select: 'colorName code' },
      })
      .skip((page - 1) * limit)
      .limit(Number(limit));
    const total = await Item.countDocuments(query);
    res.json({ items, total });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Add new item
router.post('/', authMiddleware, async (req, res) => {
  const { productId, quantity, barcode, shelf, minStock, maxStock } = req.body;
  try {
    const item = new Item({
      productId,
      quantity,
      barcode: barcode || null,
      shelf: shelf || null,
      minStock,
      maxStock,
      userId: req.user.userId,
    });
    await item.save();
    const populatedItem = await Item.findById(item._id).populate({
      path: 'productId',
      populate: { path: 'colorId', select: 'colorName code' },
    });
    res.json({ message: 'Item added successfully', item: populatedItem });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Server error' });
  }
});

// Update item
router.put('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { productId, quantity, barcode, shelf, minStock, maxStock } = req.body;
  try {
    const item = await Item.findOneAndUpdate(
      { _id: id, userId: req.user.userId },
      { productId, quantity, barcode, shelf, minStock, maxStock },
      { new: true }
    ).populate({
      path: 'productId',
      populate: { path: 'colorId', select: 'colorName code' },
    });
    if (!item) return res.status(404).json({ message: 'Item not found' });
    res.json({ message: 'Item updated successfully', item });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Server error' });
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

// Scan item by barcode
router.get('/scan/:barcode', authMiddleware, async (req, res) => {
  const { barcode } = req.params;
  try {
    const item = await Item.findOne({ barcode, userId: req.user.userId }).populate({
      path: 'productId',
      populate: { path: 'colorId', select: 'colorName code' },
    });
    if (!item) return res.status(404).json({ message: 'Item not found' });
    res.json(item);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;