const Receipt = require('../models/Receipt');
const multer = require('multer');
const path = require('path');
const fs = require('fs'); // Add fs for file deletion

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
    console.log('Received request to create receipt:', req.body);
  try {
    const data = {
      ...req.body,
      receiptImage: req.file ? req.file.path : null,
      user: req.body.user // Assuming auth middleware provides user ID
    };
    const newReceipt = await Receipt.create(data);
    res.status(201).json(newReceipt);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get all receipts (for authenticated user)
exports.getReceipts = async (req, res) => {
            console.log('Received request to create receipt:', req.user.userId);

  try {
    const receipts = await Receipt.find({ user: req.user.userId }).sort({ date: -1 });
    res.json(receipts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Update receipt
exports.updateReceipt = async (req, res) => {
            console.log('Received request to create receipt:', req.body);

  try {
    const { id } = req.params;
    const receipt = await Receipt.findOne({ _id: id, user: req.body.user });

    if (!receipt) {
      return res.status(404).json({ error: 'Receipt not found' });
    }

    const data = {
      ...req.body,
      receiptImage: req.file ? req.file.path : receipt.receiptImage
    };

    // If new image is uploaded, delete the old one if it exists
    if (req.file && receipt.receiptImage) {
      fs.unlink(receipt.receiptImage, (err) => {
        if (err) console.error('Error deleting old receipt image:', err);
      });
    }

    const updatedReceipt = await Receipt.findByIdAndUpdate(id, data, { 
      new: true, 
      runValidators: true 
    });

    res.json(updatedReceipt);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Delete receipt
exports.deleteReceipt = async (req, res) => {

  try {
    const { id } = req.params;
    const receipt = await Receipt.findOne({ _id: id, user: req.user.userId });

    if (!receipt) {
      return res.status(404).json({ error: 'Receipt not found' });
    }

    // Delete associated image file if it exists
    if (receipt.receiptImage) {
      fs.unlink(receipt.receiptImage, (err) => {
        if (err) console.error('Error deleting receipt image:', err);
      });
    }

    await Receipt.findByIdAndDelete(id);
    res.json({ message: 'Receipt deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

