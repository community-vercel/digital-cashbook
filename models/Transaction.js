// models/Transaction.js
const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  totalAmount: { type: Number, required: true },
  payable: { type: Number, default: 0 },
  receivable: { type: Number, default: 0 },
  description: { type: String },
  category: { type: String, default: 'Other' },
  type: { type: String, default: 'Cash' },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  shopId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', required: true }, // Added
  transactionImage: { type: String },
  isRecurring: { type: Boolean, default: false },
  transactionType: {
    type: String,
    enum: ['payable', 'receivable'],
    required: true,
  },
  date: { type: Date, default: Date.now },
  dueDate: { type: Date, default: undefined },
  createdAt: { type: Date, default: Date.now },
});

transactionSchema.pre('save', function (next) {
  if (this.dueDate === null) this.dueDate = undefined;
  next();
});

transactionSchema.pre('validate', function (next) {
  if (this.dueDate === null) this.dueDate = undefined;
  next();
});

module.exports = mongoose.model('Transaction', transactionSchema);