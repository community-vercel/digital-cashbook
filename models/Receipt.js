const mongoose = require('mongoose');

const receiptSchema = new mongoose.Schema({
  amount: { type: Number, required: true },
  description: { type: String, required: true },
  category: { type: String, default: 'General' },
  date: { type: Date, default: Date.now },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receiptImage: { type: String }, // Path to uploaded receipt image
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Receipt', receiptSchema);