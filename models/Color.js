const mongoose = require('mongoose');

const colorSchema = new mongoose.Schema({
  colorName: { type: String, required: true, unique: true },
  code: { type: String, required: false }, // e.g., hex code (#FFFFFF)
  colorCode: { type: String, required: true, unique: true }, // e.g., "RED01"
});

module.exports = mongoose.model('Color', colorSchema);