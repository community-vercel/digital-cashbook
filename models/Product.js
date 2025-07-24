const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true }, // Removed unique: true
  costPrice: { type: Number, required: true, min: 0 },
  retailPrice: { type: Number, required: true, min: 0 },
  discountPercentage: { type: Number, required: true, min: 0, max: 100 },
  category: {
    type: String,
    required: true,
    enum: ['gallon', 'quarter', 'drums', 'liters','Dibbi'],
  },
});

// Add compound unique index on name and category
productSchema.index({ name: 1, category: 1 }, { unique: true });

module.exports = mongoose.model('Product', productSchema);