const express = require('express');
const jwt = require('jsonwebtoken');
const Product = require('../models/Product');
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

// Get all products with search and pagination
router.get('/', authMiddleware, async (req, res) => {
  const { search, page = 1, limit = 10 } = req.query;
  const query = {};

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { category: { $regex: search, $options: 'i' } },
    ];
  }

  try {
    const products = await Product.find(query)
      .skip((page - 1) * limit)
      .limit(Number(limit));
    const total = await Product.countDocuments(query);
    res.json({ products, total });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});
router.get('/itemssearch', authMiddleware, async (req, res) => {
  const { search, page = 1, limit = 100000 } = req.query;
  const query = {};

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { category: { $regex: search, $options: 'i' } },
    ];
  }

  try {
    const products = await Product.find(query)
      .skip((page - 1) * limit)
      .limit(Number(limit));
    const total = await Product.countDocuments(query);
    res.json({ products, total });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Add new product
router.post('/', authMiddleware, async (req, res) => {
  const { name, costPrice, retailPrice, discountPercentage, category } = req.body;
  try {
    // Validate inputs
    if (costPrice < 0 || retailPrice < 0) {
      return res.status(400).json({ message: 'Prices cannot be negative' });
    }
    if (discountPercentage < 0 || discountPercentage > 100) {
      return res.status(400).json({ message: 'Discount percentage must be between 0 and 100' });
    }
    const product = new Product({
      name,
      costPrice,
      retailPrice,
      discountPercentage,
      category,
    });
    await product.save();
    res.json({ message: 'Product added successfully', product });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: `A product with the name "${name}" and category "${category}" already exists` });
    }
    res.status(500).json({ message: error.message || 'Server error' });
  }
});

// Update product
router.put('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { name, costPrice, retailPrice, discountPercentage, category } = req.body;
  try {
    // Validate inputs
    if (costPrice < 0 || retailPrice < 0) {
      return res.status(400).json({ message: 'Prices cannot be negative' });
    }
    if (discountPercentage < 0 || discountPercentage > 100) {
      return res.status(400).json({ message: 'Discount percentage must be between 0 and 100' });
    }
    const product = await Product.findByIdAndUpdate(
      id,
      { name, costPrice, retailPrice, discountPercentage, category },
      { new: true }
    );
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.json({ message: 'Product updated successfully', product });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: `A product with the name "${name}" and category "${category}" already exists` });
    }
    res.status(500).json({ message: error.message || 'Server error' });
  }
});

// Delete product
router.delete('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const itemCount = await Item.countDocuments({ productId: id });
    if (itemCount > 0) {
      return res.status(400).json({ message: 'Cannot delete product because it is referenced by inventory items' });
    }
    const product = await Product.findByIdAndDelete(id);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Server error' });
  }
});

module.exports = router;