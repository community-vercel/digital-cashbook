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

// IMPORTANT: Define specific routes BEFORE parameterized routes

// Get totals
router.get('/totals', authMiddleware, async (req, res) => {
  try {
    const { search } = req.query;
    const query = search
      ? { $or: [{ name: { $regex: search, $options: 'i' } }, { category: { $regex: search, $options: 'i' } }] }
      : {};

    const products = await Product.find(query);
    const totals = products.reduce(
      (acc, product) => {
        acc.totalCostPrice += product.costPrice || 0;
        acc.totalRetailPrice += product.retailPrice || 0;
        acc.totalSalePrice +=
          (product.retailPrice * (1 - (product.discountPercentage || 0) / 100)) || 0;
        return acc;
      },
      { totalCostPrice: 0, totalRetailPrice: 0, totalSalePrice: 0 }
    );

    res.json(totals);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch totals' });
  }
});

// Items search
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

// Export products to JSON (for PDF generation on frontend)
router.get('/export', authMiddleware, async (req, res) => {
  const { search, productIds } = req.query;

  try {
    let query = {};

    // If specific product IDs are provided
    if (productIds) {
      const ids = productIds.split(',').filter(id => id);
      query._id = { $in: ids };
    }
    // Otherwise use search filter
    else if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } },
      ];
    }

    const products = await Product.find(query).sort({ name: 1 });

    // Calculate totals
    const totals = products.reduce(
      (acc, product) => {
        acc.totalCostPrice += product.costPrice || 0;
        acc.totalRetailPrice += product.retailPrice || 0;
        acc.totalSalePrice +=
          (product.retailPrice * (1 - (product.discountPercentage || 0) / 100)) || 0;
        return acc;
      },
      { totalCostPrice: 0, totalRetailPrice: 0, totalSalePrice: 0 }
    );

    res.json({
      products,
      totals,
      exportDate: new Date().toISOString(),
      totalCount: products.length
    });
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ message: error.message || 'Failed to export products' });
  }
});

// Bulk update products (cost price, retail price, or discount)
router.put('/bulk-update', authMiddleware, async (req, res) => {
  const { productIds, field, value } = req.body;

  // Validation
  if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
    return res.status(400).json({ message: 'Product IDs array is required' });
  }

  if (!field || !['costPrice', 'retailPrice', 'discountPercentage'].includes(field)) {
    return res.status(400).json({ message: 'Invalid field. Must be costPrice, retailPrice, or discountPercentage' });
  }

  if (value === undefined || value === null) {
    return res.status(400).json({ message: 'Value is required' });
  }

  const numValue = Number(value);
  if (isNaN(numValue) || numValue < 0) {
    return res.status(400).json({ message: 'Value must be a positive number' });
  }

  if (field === 'discountPercentage' && (numValue < 0 || numValue > 100)) {
    return res.status(400).json({ message: 'Discount percentage must be between 0 and 100' });
  }

  try {
    const updateData = {};
    updateData[field] = numValue;

    const result = await Product.updateMany(
      { _id: { $in: productIds } },
      { $set: updateData }
    );

    res.json({
      message: `Successfully updated ${result.modifiedCount} product(s)`,
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    console.error('Bulk update error:', error);
    res.status(500).json({ message: error.message || 'Failed to update products' });
  }
});

// Bulk update by percentage (increase/decrease prices by %)
router.put('/bulk-update-percentage', authMiddleware, async (req, res) => {
  const { productIds, field, percentage, operation } = req.body;

  // Validation
  if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
    return res.status(400).json({ message: 'Product IDs array is required' });
  }

  if (!field || !['costPrice', 'retailPrice'].includes(field)) {
    return res.status(400).json({ message: 'Invalid field. Must be costPrice or retailPrice' });
  }

  if (!operation || !['increase', 'decrease'].includes(operation)) {
    return res.status(400).json({ message: 'Operation must be increase or decrease' });
  }

  const percentValue = Number(percentage);
  if (isNaN(percentValue) || percentValue < 0 || percentValue > 100) {
    return res.status(400).json({ message: 'Percentage must be between 0 and 100' });
  }

  try {
    const products = await Product.find({ _id: { $in: productIds } });
    
    const bulkOps = products.map(product => {
      const currentValue = product[field];
      const multiplier = operation === 'increase' 
        ? (1 + percentValue / 100) 
        : (1 - percentValue / 100);
      const newValue = Math.max(0, currentValue * multiplier);

      return {
        updateOne: {
          filter: { _id: product._id },
          update: { $set: { [field]: newValue } }
        }
      };
    });

    const result = await Product.bulkWrite(bulkOps);

    res.json({
      message: `Successfully updated ${result.modifiedCount} product(s)`,
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    console.error('Bulk percentage update error:', error);
    res.status(500).json({ message: error.message || 'Failed to update products' });
  }
});

// Bulk delete products
router.delete('/bulk-delete', authMiddleware, async (req, res) => {
  const { productIds } = req.body;

  if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
    return res.status(400).json({ message: 'Product IDs array is required' });
  }

  try {
    // Check if any products are referenced by inventory items
    const itemCount = await Item.countDocuments({ productId: { $in: productIds } });
    if (itemCount > 0) {
      return res.status(400).json({
        message: `Cannot delete products because ${itemCount} inventory item(s) reference them. Please remove inventory items first.`
      });
    }

    const result = await Product.deleteMany({ _id: { $in: productIds } });

    res.json({
      message: `Successfully deleted ${result.deletedCount} product(s)`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Bulk delete error:', error);
    res.status(500).json({ message: error.message || 'Failed to delete products' });
  }
});

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

// Add new product
router.post('/', authMiddleware, async (req, res) => {
  const { name, costPrice, retailPrice, discountPercentage, category, weight } = req.body;
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
      weight,
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
  const { name, costPrice, retailPrice, discountPercentage, category, weight } = req.body;
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
      { name, costPrice, retailPrice, discountPercentage, category, weight },
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