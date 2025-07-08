const mongoose = require('mongoose');

const colorSchema = new mongoose.Schema({
  colorName: { type: String, required: true, unique: true },
  code: { type: String, required: true }, // e.g., hex code (#FFFFFF)
});

module.exports = mongoose.model('Color', colorSchema);