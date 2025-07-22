const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  quantity: { type: Number, required: true, default: 0 },
  barcode: { type: String, unique: true, sparse: true }, // Optional barcode
  shelf: { type: String, required: false }, // Shelf location
  minStock: { type: Number, default: 5 },
  maxStock: { type: Number, default: 50 },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  color: { type: String, required: true }, // e.g., "Red"
  colorCode: { type: String, required: true }, // e.g., "RED01"
  category: {
    type: String,
    required: true,
    enum: ['gallon', 'quarter', 'drums', 'liters'],
  },
  discountPercentage: { type: Number, required: true, default: 0, min: 0, max: 100 }, // Discount for this item
  salePrice: { type: Number, required: true, min: 0 }, // Calculated sale price
});

// Pre-save middleware to calculate salePrice
itemSchema.pre('save', async function (next) {
  if (this.isModified('productId') || this.isModified('discountPercentage')) {
    const Product = mongoose.model('Product');
    const product = await Product.findById(this.productId);
    if (product) {
      this.salePrice = product.retailPrice - (product.retailPrice * this.discountPercentage) / 100;
    }
  }
  next();
});

// Pre-update middleware to calculate salePrice
itemSchema.pre(['findOneAndUpdate', 'updateOne'], async function (next) {
  const update = this.getUpdate();
  if (update.productId || update.discountPercentage) {
    const Product = mongoose.model('Product');
    const product = await Product.findById(update.productId || this._conditions._id);
    if (product) {
      update.salePrice = product.retailPrice - (product.retailPrice * (update.discountPercentage || this._conditions.discountPercentage || 0)) / 100;
    }
  }
  next();
});

module.exports = mongoose.model('Item', itemSchema);