const mongoose = require('mongoose');

const settingSchema = new mongoose.Schema({
  siteName: { type: String, required: true },
  phone: { type: String },
  logo: { type: String }, // Store logo path or URL
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Setting', settingSchema);