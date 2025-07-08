// models/Transaction.js
const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  totalAmount: { type: Number, required: true },
  payable: { type: Number, default: 0 },
  receivable: { type: Number, default: 0 },
  description: { type: String, required: true },
  category: { type: String, default: 'General' },
  type: { type: String, default: 'Cash' }, // Renamed to paymentMethod in frontend
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  transactionImage: { type: String },
  isRecurring: { type: Boolean, default: false },
  transactionType: {
    type: String,
    enum: ['payable', 'receivable'],
    required: true,
  },
  date: { type: Date, default: Date.now },
  dueDate: { type: Date },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Transaction', transactionSchema);