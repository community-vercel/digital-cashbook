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
    query.$or = [
      { 'productId.name': { $regex: search, $options: 'i' } },
      { category: { $regex: search, $options: 'i' } },
      { shelf: { $regex: search, $options: 'i' } },
      { color: { $regex: search, $options: 'i' } },
      { colorCode: { $regex: search, $options: 'i' } },
    ];
  }

  try {
    const items = await Item.find(query)
      .populate('productId')
      .skip((page - 1) * limit)
      .limit(Number(limit));
    const total = await Item.countDocuments(query);
    res.json({ items, total });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Add new item
// Add new item
router.post('/', authMiddleware, async (req, res) => {
  const { productId, quantity, barcode, shelf, minStock, maxStock, color, colorCode, category, discountPercentage } = req.body;
  try {
    // Validate inputs
    if (quantity < 0 || minStock < 0 || maxStock < 0) {
      return res.status(400).json({ message: 'Quantity, min stock, and max stock cannot be negative' });
    }
    if (minStock > maxStock) {
      return res.status(400).json({ message: 'Min stock cannot be greater than max stock' });
    }
    if (discountPercentage < 0 || discountPercentage > 100) {
      return res.status(400).json({ message: 'Discount percentage must be between 0 and 100' });
    }
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(400).json({ message: 'Invalid product ID' });
    }
    if (product.category !== category) {
      return res.status(400).json({ message: 'Selected category does not match product category' });
    }

    const item = new Item({
      productId,
      quantity,
      barcode: barcode || null,
      shelf: shelf || null,
      minStock,
      maxStock,
      userId: req.user.userId,
      color,
      colorCode,
      category,
      discountPercentage,
    });
    await item.save();
    const populatedItem = await Item.findById(item._id).populate('productId');
    res.json({ message: 'Item added successfully', item: populatedItem });
  } catch (error) {
    if (error.code === 11000 && error.keyPattern?.productId && error.keyPattern?.category) {
      return res.status(400).json({ message: 'An item with this product and category already exists for this user' });
    }
    if (error.code === 11000 && error.keyPattern?.barcode) {
      return res.status(400).json({ message: 'Barcode already exists' });
    }
    res.status(500).json({ message: error.message || 'Server error' });
  }
});

// Update item
router.put('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { productId, quantity, barcode, shelf, minStock, maxStock, color, colorCode, category, discountPercentage } = req.body;
  try {
    // Validate inputs
    if (quantity < 0 || minStock < 0 || maxStock < 0) {
      return res.status(400).json({ message: 'Quantity, min stock, and max stock cannot be negative' });
    }
    if (minStock > maxStock) {
      return res.status(400).json({ message: 'Min stock cannot be greater than max stock' });
    }
    if (discountPercentage < 0 || discountPercentage > 100) {
      return res.status(400).json({ message: 'Discount percentage must be between 0 and 100' });
    }
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(400).json({ message: 'Invalid product ID' });
    }
    if (product.category !== category) {
      return res.status(400).json({ message: 'Selected category does not match product category' });
    }
    const item = await Item.findOneAndUpdate(
      { _id: id, userId: req.user.userId },
      { productId, quantity, barcode, shelf, minStock, maxStock, color, colorCode, category, discountPercentage },
      { new: true }
    ).populate('productId');
    if (!item) return res.status(404).json({ message: 'Item not found' });
    res.json({ message: 'Item updated successfully', item });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Barcode already exists' });
    }
    res.status(500).json({ message: error.message || 'Server error' });
  }
});

// Get item by ID
router.get('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const item = await Item.findOne({ _id: id, userId: req.user.userId }).populate('productId');
    if (!item) return res.status(404).json({ message: 'Item not found' });
    res.json(item);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});
router.get('/audit-logs', authMiddleware, async (req, res) => {
  console.log('GET /items/audit-logs received:');
    console.log('GET /items/audit-logs received:', req.query);

  const { page = 1, limit = 10, entityId } = req.query;
  try {
    // Validate query parameters
    const pageNum = Number(page);
    const limitNum = Number(limit);
    if (isNaN(pageNum) || pageNum < 1 || isNaN(limitNum) || limitNum < 1) {
      return res.status(400).json({ message: 'Invalid page or limit parameters' });
    }

    const query = { userId: req.user.userId, entity: 'Item' };
    if (entityId) {
      if (!mongoose.isValidObjectId(entityId)) {
        return res.status(400).json({ message: 'Invalid entityId format' });
      }
      query.entityId = entityId;

      // Verify entityId exists in Item collection
      const itemExists = await Item.findById(entityId).lean();
      if (!itemExists) {
        return res.status(404).json({ message: 'Item not found for the provided entityId' });
      }
    }

    const logs = await AuditLog.find(query)
      .populate({
        path: 'userId',
        select: 'username',
        options: { strictPopulate: false, lean: true },
      })
      .populate({
        path: 'entityId',
        select: 'productId quantity category', // Only fetch relevant fields
        options: { strictPopulate: false, lean: true },
      })
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean(); // Convert to plain JS object for performance

    const total = await AuditLog.countDocuments(query);
    res.json({ logs, total });
  } catch (error) {
    console.error('Error in GET /items/audit-logs:', {
      message: error.message,
      stack: error.stack,
      query: { page, limit, entityId, userId: req.user?.userId },
    });
    res.status(500).json({ message: 'Server error', error: error.message });
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
    const item = await Item.findOne({ barcode, userId: req.user.userId }).populate('productId');
    if (!item) return res.status(404).json({ message: 'Item not found' });
    res.json(item);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});


module.exports = router;