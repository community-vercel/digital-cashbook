const express = require('express');
const jwt = require('jsonwebtoken');
const Color = require('../models/Color');
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

// Get all colors with search and pagination
router.get('/', authMiddleware, async (req, res) => {
  const { search, page = 1, limit = 10 } = req.query;
  const query = {};

  if (search) {
    query.$or = [
      { colorName: { $regex: search, $options: 'i' } },
      { code: { $regex: search, $options: 'i' } },
      { colorCode: { $regex: search, $options: 'i' } },
    ];
  }

  try {
    const colors = await Color.find(query)
      .skip((page - 1) * limit)
      .limit(Number(limit));
    const total = await Color.countDocuments(query);
    res.json({ colors, total });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});
// GET /api/colors - Get all colors
router.get('/allcolors', async (req, res) => {
  try {
    const colors = await Color.find().sort({ colorName: 1 }); // sorted by name
    res.status(200).json(colors);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching colors', error });
  }
});
// Add new color
router.post('/', authMiddleware, async (req, res) => {
  const { colorName, code, colorCode } = req.body;
  try {
    // Validate presence of colorName and colorCode
    if (!colorName || !colorCode) {
      return res.status(400).json({
        message: 'Both colorName and colorCode are required',
      });
    }

    // Validate colorCode format (e.g., alphanumeric, 3-10 characters)
    if (!/^[A-Z0-9]{3,10}$/.test(colorCode)) {
      return res.status(400).json({
        message: 'Color code must be alphanumeric and 3-10 characters',
      });
    }

    // Create new color (compound index will handle duplicate checks)
    const color = new Color({ colorName, code, colorCode });
    await color.save();
    res.json({ message: 'Color added successfully', color });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        message: `A color with the same name (${colorName}) and code (${colorCode}) already exists`,
      });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        message: error.message,
      });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// Update color
router.put('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { colorName, code, colorCode } = req.body;
  try {
    // Validate presence of colorName and colorCode
    if (!colorName || !colorCode) {
      return res.status(400).json({
        message: 'Both colorName and colorCode are required',
      });
    }

    // Validate colorCode format
    if (!/^[A-Z0-9]{3,10}$/.test(colorCode)) {
      return res.status(400).json({
        message: 'Color code must be alphanumeric and 3-10 characters',
      });
    }

    const color = await Color.findByIdAndUpdate(
      id,
      { colorName, code, colorCode },
      { new: true }
    );
    if (!color) return res.status(404).json({ message: 'Color not found' });
    res.json({ message: 'Color updated successfully', color });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        message: `A color with the same name (${colorName}) and code (${colorCode}) already exists`,
      });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        message: error.message,
      });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete color
router.delete('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const productCount = await Product.countDocuments({ colorId: id });
    if (productCount > 0) {
      return res.status(400).json({
        message: 'Cannot delete color because it is referenced by products',
      });
    }
    const color = await Color.findByIdAndDelete(id);
    if (!color) return res.status(404).json({ message: 'Color not found' });
    res.json({ message: 'Color deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;