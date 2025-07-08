const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  quantity: { type: Number, required: true, default: 0 },
  price: { type: Number, required: true },
  barcode: { type: String, unique: true, sparse: true }, // Optional barcode
  category: { type: String, required: true },
  shelf: { type: String, required: false }, // Shelf location
  minStock: { type: Number, default: 5 },
  maxStock: { type: Number, default: 50 },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
});

module.exports = mongoose.model('Item', itemSchema);