const Receipt = require('../models/Receipt');
const multer = require('multer');
const path = require('path');

// Configure Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/'); // Make sure 'uploads' folder exists
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

// Middleware to handle file uploads
exports.uploadReceiptImage = multer({ storage }).single('receiptImage');

// Create receipt
exports.createReceipt = async (req, res) => {
  try {
    const data = {
      ...req.body,
      receiptImage: req.file ? req.file.path : null
    };
    const newReceipt = await Receipt.create(data);
    res.status(201).json(newReceipt);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get all receipts (for authenticated user)
exports.getReceipts = async (req, res) => {
  try {
    const receipts = await Receipt.find({ user: req.user.id }).sort({ date: -1 });
    res.json(receipts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};