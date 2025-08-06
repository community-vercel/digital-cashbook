// backend/models/Setting.js
const mongoose = require('mongoose');

const settingSchema = new mongoose.Schema({
  siteName: { type: String, required: true },
  phone: { type: String },
  logo: { type: String },
  openingBalance: { type: Number, default: null }, // Null until set
  openingBalanceSet: { type: Boolean, default: false }, // Flag to prevent updates
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  shopId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', required: true }


});

module.exports = mongoose.model('Setting', settingSchema);