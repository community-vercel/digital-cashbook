const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  price: { type: Number, required: true },
  colorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Color', required: true },
  category: {
    type: String,
    required: true,
    enum: ['gallon', 'quarter', 'drums', 'liters'],
  },
});

module.exports = mongoose.model('Product', productSchema);