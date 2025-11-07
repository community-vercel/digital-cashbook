const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  quantity: { type: Number, required: true, default: 0 },
  barcode: { type: String, unique: false, sparse: true },
  shelf: { type: String, required: false },
  minStock: { type: Number, default: 5 },
  maxStock: { type: Number, default: 50 },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  shopId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop' }, // Optional for shop-specific items
  color: { type: String },
  colorCode: { type: String },
  category: {
    type: String,
    required: true,
    enum: ['gallon', 'quarter', 'drums', 'liters', 'Kg', 'packet', 'piece', 'bag', 'bottles', 'cans'],
  },
  discountPercentage: { type: Number, required: true, default: 0, min: 0, max: 100 },
  isSuperadminItem: { type: Boolean, default: false }, // NEW: Flag for global items
});

// Unique index for regular user items (per user)
itemSchema.index({ productId: 1, category: 1, userId: 1 }, { 
  unique: true,
  partialFilterExpression: { isSuperadminItem: false }
});

// Unique index for superadmin items (global - shared by all superadmins)
itemSchema.index({ productId: 1, category: 1 }, { 
  unique: true,
  partialFilterExpression: { isSuperadminItem: true }
});

module.exports = mongoose.model('Item', itemSchema);