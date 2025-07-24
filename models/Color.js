const mongoose = require('mongoose');

const colorSchema = new mongoose.Schema({
  colorName: { type: String, required: true },
  code: { type: String, required: false }, // e.g., hex code (#FFFFFF)
  colorCode: { type: String, required: true }, // e.g., "RED01"
});

// Add a compound unique index for colorName and colorCode
colorSchema.index({ colorName: 1, colorCode: 1 }, { unique: true });

module.exports = mongoose.model('Color', colorSchema);