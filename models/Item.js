const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  quantity: { type: Number, required: true, default: 0 },
  barcode: { type: String, unique: true, sparse: true }, // Optional barcode
  shelf: { type: String, required: false }, // Shelf location
  minStock: { type: Number, default: 5 },
  maxStock: { type: Number, default: 50 },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
});

module.exports = mongoose.model('Item', itemSchema);