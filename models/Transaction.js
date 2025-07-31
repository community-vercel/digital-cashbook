  // models/Transaction.js
  const mongoose = require('mongoose');

  const transactionSchema = new mongoose.Schema({
    totalAmount: { type: Number, required: true },
    payable: { type: Number, default: 0 },
    receivable: { type: Number, default: 0 },
    description: { type: String },
    category: { type: String, default: 'Other' },
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
    dueDate: { 
      type: Date, 
      default: undefined // Explicitly set to undefined instead of null
    },
    createdAt: { type: Date, default: Date.now },
  });

  // Pre-save middleware to handle dueDate
  transactionSchema.pre('save', function(next) {
    // Only set dueDate to undefined if it's explicitly null
    if (this.dueDate === null) {
      this.dueDate = undefined;
    }
    next();
  });

  // Pre-validate middleware
  transactionSchema.pre('validate', function(next) {
    // Ensure dueDate is not set to null during validation
    if (this.dueDate === null) {
      this.dueDate = undefined;
    }
    next();
  });

  module.exports = mongoose.model('Transaction', transactionSchema);