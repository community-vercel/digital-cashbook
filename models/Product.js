const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  costPrice: { type: Number, required: true, min: 0 },
  retailPrice: { type: Number, required: true, min: 0 },
  discountPercentage: { type: Number, required: true, min: 0, max: 100 },
  weight: { type: String }, // Changed to String to allow formats like "5kg", "2L", etc.
  category: {
    type: String,
    required: true,
    enum: [
      'gallon',
      'quarter',
      'drums',
      'liters',
      'Dibbi',
      'Kg',
      'packet',
      'piece',
      'bag',
      'bottles',
      'cans',
      'others',
    ],
  },
});

// Compound unique index on name and category
productSchema.index({ name: 1, category: 1 }, { unique: true });

module.exports = mongoose.model('Product', productSchema);