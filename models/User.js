// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['superadmin', 'admin', 'user'], default: 'user' },
  shopId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop' },
  createdAt: { type: Date, default: Date.now },
  refreshToken: { type: String } // Added for refresh token storage
});

userSchema.pre('save', async function (next) {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  next();
});

module.exports = mongoose.model('User', userSchema);