const express = require('express');
const jwt = require('jsonwebtoken');
const Item = require('../models/Item');
const Product = require('../models/Product');
const AuditLog = require('../models/AuditLog');
const router = express.Router();
const mongoose = require('mongoose');
const Shop = require('../models/Shop'); // Add Shop model

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

router.get('/shops', authMiddleware, async (req, res) => {
  try {
    const shops = await Shop.find().select('_id name location');
    res.json({ shops });
  } catch (error) {
    console.error('Error fetching shops:', error);
    res.status(500).json({ message: 'Failed to fetch shops' });
  }
});
// Check if item exists with productId and category
router.get('/check', authMiddleware, async (req, res) => {
  const { productId, category, excludeId } = req.query;
  try {
    if (!mongoose.isValidObjectId(productId)) {
      console.log('Invalid productId:', productId);
      return res.status(400).json({ message: 'Invalid product ID' });
    }
    if (!['gallon', 'quarter', 'drums', 'liters',  'Kg','packet', 'piece', 'bag', 'bottles', 'cans',].includes(category)) {
      console.log('Invalid category:', category);
      return res.status(400).json({ message: 'Invalid category' });
    }
    // Build the query, excluding the item with excludeId if provided
    const query = { productId, category, userId: req.user.userId };
    if (excludeId && mongoose.isValidObjectId(excludeId)) {
      query._id = { $ne: excludeId };
    }
    console.log('Checking item with query:', query);
    const item = await Item.findOne(query);
    console.log('Check item result:', item ? 'Exists' : 'Does not exist', { productId, category, excludeId, userId: req.user.userId });
    return res.json({ exists: !!item });
  } catch (error) {
    console.error('Error in /items/check:', error.message, error.stack);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
});
router.get('/quantity', authMiddleware, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1; // Default to page 1
    const limit = parseInt(req.query.limit) || 10; // Default to 10 items per page
    const skip = (page - 1) * limit;
    // const items = await Item.find({ userId: req.user.userId })

    // Fetch items with pagination
    const items = await Item.find()
      .populate('productId', 'name')
      .select('productId quantity userId')
      .skip(skip)
      .limit(limit);

    // Get total count for pagination metadata
    const totalItems = await Item.countDocuments();

    
    if (items.length === 0 && page === 1) {
      return res.status(404).json({ message: 'No items found' });
    }

    res.status(200).json({
      message: 'Items fetched successfully',
      data: items,
      pagination: {
        totalItems,
        totalPages: Math.ceil(totalItems / limit),
        currentPage: page,
        limit,
      },
    });
  } catch (error) {
    console.error('Error fetching items:', error);
    res.status(500).json({ message: 'Server error' });
  }
});
router.patch('/:id/quantity', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { operation, amount } = req.body;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid item ID' });
    }

    if (!['add', 'remove'].includes(operation)) {
      return res.status(400).json({ message: 'Invalid operation. Use "add" or "remove"' });
    }
    if (!Number.isInteger(amount) || amount < 0) {
      return res.status(400).json({ message: 'Amount must be a non-negative integer' });
    }

    const item = await Item.findOne({ _id: id, userId: req.user.userId });
    if (!item) {
      return res.status(404).json({ message: 'Item not found or unauthorized' });
    }

    let newQuantity = item.quantity;
    if (operation === 'add') {
      newQuantity += amount;
      if (newQuantity > item.maxStock) {
        return res.status(400).json({ message: `Quantity cannot exceed maxStock of ${item.maxStock}` });
      }
    } else {
      newQuantity -= amount;
      if (newQuantity < 0) {
        return res.status(400).json({ message: 'Quantity cannot be negative' });
      }
    }

    // Prepare changes for audit log
    const changes = {
      quantity: {
        old: item.quantity,
        new: newQuantity,
      },

    };

    const updatedItem = await Item.findByIdAndUpdate(
      id,
      { $set: { quantity: newQuantity } },
      { new: true, runValidators: true }
    ).populate('productId', 'name');

    // Create audit log entry
    const auditLog = new AuditLog({
      action: 'UPDATE',
      entity: 'Item',
      entityId: updatedItem._id,
      userId: req.user.userId,
      changes,
    });
    await auditLog.save();

    console.log('Quantity updated:', updatedItem);
    res.status(200).json({
      message: 'Quantity updated successfully',
      data: updatedItem,
    });
  } catch (error) {
    console.error('Error updating quantity:', error);
    res.status(500).json({ message: error.message || 'Server error' });
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



router.get('/totals', async (req, res) => {
  try {
    const { search } = req.query;
    const query = search
      ? {
          $or: [
            { 'productId.name': { $regex: search, $options: 'i' } },
            { category: { $regex: search, $options: 'i' } },
            { shelf: { $regex: search, $options: 'i' } },
            { color: { $regex: search, $options: 'i' } },
            { barcode: { $regex: search, $options: 'i' } },
          ],
        }
      : {};

    // Aggregate totals
    const items = await Item.find(query).populate('productId');
    const totals = items.reduce(
      (acc, item) => {
        const quantity = item.quantity || 0;
        const costPrice = item.productId?.costPrice || 0;
        const retailPrice = item.productId?.retailPrice || 0;
        const discountPercentage = item.discountPercentage || 0;
        const salePrice = retailPrice - (retailPrice * discountPercentage) / 100;

        acc.totalQuantity += quantity;
        acc.totalCostPrice += quantity * costPrice;
        acc.totalRetailPrice += quantity * retailPrice;
        acc.totalSalePrice += quantity * salePrice;

        return acc;
      },
      { totalQuantity: 0, totalCostPrice: 0, totalRetailPrice: 0, totalSalePrice: 0 }
    );

    res.json(totals);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch totals' });
  }
});


router.get('/', authMiddleware, async (req, res) => {
  const { search, page = 1, limit = 10 } = req.query;
  const query = {};

  try {
    // Filter based on user role
    if (req.user.role === 'superadmin') {
      // Superadmin sees all items (both global and user-specific)
      // No additional filter needed
    } else {
      // Regular users see global items + their own items
      query.$or = [
        { isSuperadminItem: true },
        { userId: req.user.userId, isSuperadminItem: false }
      ];
    }

    // Step 1: Find product IDs matching the search term (if provided)
    let productIds = [];
    if (search) {
      const products = await Product.find({
        name: { $regex: search, $options: 'i' },
      }).select('_id');
      productIds = products.map((p) => p._id);
    }

    // Step 2: Build the Item query
    if (search) {
      const searchConditions = [
        ...(productIds.length ? [{ productId: { $in: productIds } }] : []),
        { category: { $regex: search, $options: 'i' } },
        { shelf: { $regex: search, $options: 'i' } },
        { color: { $regex: search, $options: 'i' } },
        { colorCode: { $regex: search, $options: 'i' } },
      ];
      
      if (query.$or) {
        query.$and = [
          { $or: query.$or },
          { $or: searchConditions }
        ];
        delete query.$or;
      } else {
        query.$or = searchConditions;
      }
    }

    // Step 3: Fetch paginated items
    const items = await Item.find(query)
      .populate('productId')
      .populate('shopId', 'name location') // Populate shop details
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .lean();

    // Step 4: Count total documents
    const total = await Item.countDocuments(query);

    res.json({ items, total });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create new item
router.post('/', authMiddleware, async (req, res) => {
  const { productId, quantity, barcode, shelf, minStock, maxStock, color, colorCode, category, discountPercentage, shopId } = req.body;
  try {
    console.log('POST /items payload:', req.body);
    
    if (!mongoose.isValidObjectId(productId)) {
      console.log('Invalid productId:', productId);
      return res.status(400).json({ message: 'Invalid product ID' });
    }
    
    if (quantity < 0 || minStock < 0 || maxStock < 0) {
      return res.status(400).json({ message: 'Quantity, min stock, and max stock cannot be negative' });
    }
    
    if (minStock > maxStock) {
      return res.status(400).json({ message: 'Min stock cannot be greater than max stock' });
    }
    
    if (discountPercentage < 0 || discountPercentage > 100) {
      return res.status(400).json({ message: 'Discount percentage must be between 0 and 100' });
    }
    
    if (!['gallon', 'quarter', 'drums', 'liters', 'Kg', 'packet', 'piece', 'bag', 'bottles', 'cans'].includes(category)) {
      console.log('Invalid category:', category);
      return res.status(400).json({ message: 'Invalid category' });
    }

    // Validate shopId if provided
    if (shopId && !mongoose.isValidObjectId(shopId)) {
      return res.status(400).json({ message: 'Invalid shop ID' });
    }

    if (shopId) {
      const shopExists = await Shop.findById(shopId);
      if (!shopExists) {
        return res.status(400).json({ message: 'Shop not found' });
      }
    }
    
    const product = await Product.findById(productId);
    if (!product) {
      console.log('Product not found for ID:', productId);
      return res.status(400).json({ message: 'Invalid product ID' });
    }
    
    if (product.category !== category) {
      console.log('Category mismatch:', { productCategory: product.category, itemCategory: category });
      return res.status(400).json({ message: 'Selected category does not match product category' });
    }

    // Determine if this is a superadmin global item
    const isSuperadminItem = req.user.role === 'superadmin' && req.body.isSuperadminItem === true;

    const item = new Item({
      productId,
      quantity,
      barcode: barcode || null,
      shelf: shelf || null,
      minStock,
      maxStock,
      userId: req.user.userId,
      shopId: shopId || null,
      color,
      colorCode,
      category,
      discountPercentage,
      isSuperadminItem
    });
    
    await item.save();

    // Create audit log entry for item creation
    const auditLog = new AuditLog({
      action: 'CREATE',
      entity: 'Item',
      entityId: item._id,
      userId: req.user.userId,
      changes: {
        newData: {
          productId,
          quantity,
          barcode,
          shelf,
          minStock,
          maxStock,
          color,
          colorCode,
          category,
          discountPercentage,
          shopId,
          isSuperadminItem
        },
      },
    });
    await auditLog.save();

    const populatedItem = await Item.findById(item._id)
      .populate('productId')
      .populate('shopId', 'name location');
    
    console.log('Item added:', populatedItem);
    res.json({ message: 'Item added successfully', item: populatedItem });
  } catch (error) {
    console.error('Error in POST /items:', error.message, error.stack);
    if (error.code === 11000) {
      if (error.keyPattern?.productId && error.keyPattern?.category) {
        return res.status(400).json({ message: 'An item with this product and category already exists' });
      }
      if (error.keyPattern?.barcode) {
        return res.status(400).json({ message: 'Barcode already exists' });
      }
    }
    res.status(500).json({ message: error.message || 'Server error' });
  }
});

// Update item
router.put('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { productId, quantity, barcode, shelf, minStock, maxStock, color, colorCode, category, discountPercentage, shopId } = req.body;
  console.log('PUT /items/:id received:', { id, productId, category, shopId });
  
  try {
    if (quantity < 0 || minStock < 0 || maxStock < 0) {
      return res.status(400).json({ message: 'Quantity, min stock, and max stock cannot be negative' });
    }
    
    if (minStock > maxStock) {
      return res.status(400).json({ message: 'Min stock cannot be greater than max stock' });
    }
    
    if (discountPercentage < 0 || discountPercentage > 100) {
      return res.status(400).json({ message: 'Discount percentage must be between 0 and 100' });
    }

    if (shopId && !mongoose.isValidObjectId(shopId)) {
      return res.status(400).json({ message: 'Invalid shop ID' });
    }

    if (shopId) {
      const shopExists = await Shop.findById(shopId);
      if (!shopExists) {
        return res.status(400).json({ message: 'Shop not found' });
      }
    }
    
    const product = await Product.findById(productId);
    console.log('Product found:', product);
    if (!product) {
      return res.status(400).json({ message: 'Invalid product ID' });
    }
    
    if (product.category !== category) {
      return res.status(400).json({ message: 'Selected category does not match product category' });
    }

    // Fetch the existing item to compare changes
    const existingItem = await Item.findOne({ _id: id, userId: req.user.userId });
    if (!existingItem) {
      console.log('Item not found for id:', id);
      return res.status(404).json({ message: 'Item not found' });
    }

    // Prepare changes object for audit log
    const changes = {};
    if (existingItem.productId.toString() !== productId) changes.productId = { old: existingItem.productId, new: productId };
    if (existingItem.quantity !== quantity) changes.quantity = { old: existingItem.quantity, new: quantity };
    if (existingItem.barcode !== barcode) changes.barcode = { old: existingItem.barcode, new: barcode };
    if (existingItem.shelf !== shelf) changes.shelf = { old: existingItem.shelf, new: shelf };
    if (existingItem.minStock !== minStock) changes.minStock = { old: existingItem.minStock, new: minStock };
    if (existingItem.maxStock !== maxStock) changes.maxStock = { old: existingItem.maxStock, new: maxStock };
    if (existingItem.color !== color) changes.color = { old: existingItem.color, new: color };
    if (existingItem.colorCode !== colorCode) changes.colorCode = { old: existingItem.colorCode, new: colorCode };
    if (existingItem.category !== category) changes.category = { old: existingItem.category, new: category };
    if (existingItem.discountPercentage !== discountPercentage)
      changes.discountPercentage = { old: existingItem.discountPercentage, new: discountPercentage };
    if (existingItem.shopId?.toString() !== shopId) changes.shopId = { old: existingItem.shopId, new: shopId };

    const item = await Item.findOneAndUpdate(
      { _id: id, userId: req.user.userId },
      { productId, quantity, barcode, shelf, minStock, maxStock, color, colorCode, category, discountPercentage, shopId },
      { new: true }
    ).populate('productId').populate('shopId', 'name location');

    if (!item) {
      console.log('Item not found for id:', id);
      return res.status(404).json({ message: 'Item not found' });
    }

    
    // Create audit log entry if there are changes
    if (Object.keys(changes).length > 0) {
      const auditLog = new AuditLog({
        action: 'UPDATE',
        entity: 'Item',
        entityId: item._id,
        userId: req.user.userId,
        changes,
      });
      await auditLog.save();
    }

    console.log('Item updated:', item);
    res.json({ message: 'Item updated successfully', item });
  } catch (error) {
    console.error('Error in PUT /items/:id:', error);
    if (error.code === 11000) {
      return res.status(400).json({ message: 'An item with this product and category already exists' });
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
// Get audit logs for items

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