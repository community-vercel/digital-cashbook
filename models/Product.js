const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  sku: { type: String, unique: true },
  barcode: { type: String, unique: true, sparse: true }, // Optional
  category: String,
  price: Number,
  cost: Number,
  quantity: { type: Number, default: 0 },
  shelfLocation: {
    aisle: String,
    shelf: String,
    position: String
  },
  image: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Product', productSchema);