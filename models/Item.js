const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  quantity: { type: Number, required: true, default: 0 },
  barcode: { type: String, unique: true, sparse: true },
  shelf: { type: String, required: false },
  minStock: { type: Number, default: 5 },
  maxStock: { type: Number, default: 50 },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  color: { type: String, required: true },
  colorCode: { type: String, required: true },
  category: {
    type: String,
    required: true,
    enum: ['gallon', 'quarter', 'drums', 'liters'],
  },
  discountPercentage: { type: Number, required: true, default: 0, min: 0, max: 100 },
});

// Ensure the barcode index is sparse
itemSchema.index({ barcode: 1 }, { unique: true, sparse: true });
itemSchema.index({ productId: 1, category: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('Item', itemSchema);