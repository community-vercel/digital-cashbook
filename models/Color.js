const mongoose = require('mongoose');

const colorSchema = new mongoose.Schema({
  colorName: {
    type: String,
    required: [true, 'Color name is required'],
    unique: true, // MongoDB unique index
    trim: true,
    validate: {
      validator: async function (value) {
        // Skip validation for updates where colorName is unchanged
        if (this.isModified('colorName') || this.isNew) {
          const existingColor = await this.constructor.findOne({
            colorName: { $regex: `^${value}$`, $options: 'i' },
            _id: { $ne: this._id }, // Exclude current document for updates
          });
          return !existingColor;
        }
        return true;
      },
      message: 'A color with the same name already exists',
    },
  },
  code: {
    type: String,
    required: false, // e.g., hex code (#FFFFFF)
    trim: true,
  },
  colorCode: {
    type: String,
    required: [true, 'Color code is required'],
    unique: true, // MongoDB unique index
    trim: true,
    match: [/^[A-Z0-9]{3,10}$/, 'Color code must be alphanumeric and 3-10 characters'],
    validate: {
      validator: async function (value) {
        // Skip validation for updates where colorCode is unchanged
        if (this.isModified('colorCode') || this.isNew) {
          const existingColor = await this.constructor.findOne({
            colorCode: { $regex: `^${value}$`, $options: 'i' },
            _id: { $ne: this._id }, // Exclude current document for updates
          });
          return !existingColor;
        }
        return true;
      },
      message: 'A color with the same color code already exists',
    },
  },
});

// Ensure unique indexes are case-insensitive
colorSchema.index({ colorName: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
colorSchema.index({ colorCode: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

module.exports = mongoose.model('Color', colorSchema);