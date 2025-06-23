const Receipt = require('../models/Receipt');
const multer = require('multer');
const path = require('path');
const fs = require('fs'); // Add fs for file deletion
const { put, del } = require('@vercel/blob');

const storage = multer.memoryStorage();
exports.uploadReceiptImage = multer({ storage }).single('receiptImage');
// Configure Multer storage


// Middleware to handle file uploads

// Create receipt
exports.createReceipt = async (req, res) => {
  try {
    let receiptImageUrl = null;

    // If a file is uploaded, store it in Vercel Blob
    if (req.file) {
      const { buffer, originalname } = req.file;
      const blob = await put(`receipts/${Date.now()}_${originalname}`, buffer, {
        access: 'public', // Set to 'private' if you want restricted access
      });
      receiptImageUrl = blob.url; // Get the URL of the uploaded file
    }

    const data = {
      ...req.body,
      receiptImage: receiptImageUrl,
      user: req.body.user, // Assuming auth middleware provides user ID
    };

    const newReceipt = await Receipt.create(data);
    res.status(201).json(newReceipt);
  } catch (err) {
    console.error(err);
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
  try {
    const { id } = req.params;
    const receipt = await Receipt.findOne({ _id: id, user: req.body.user });

    if (!receipt) {
      return res.status(404).json({ error: 'Receipt not found' });
    }

    let receiptImageUrl = receipt.receiptImage;

    // If a new file is uploaded, upload to Vercel Blob and delete the old one
    if (req.file) {
      const { buffer, originalname } = req.file;
      const blob = await put(`receipts/${Date.now()}_${originalname}`, buffer, {
        access: 'public',
      });
      receiptImageUrl = blob.url;

      // Delete the old file from Vercel Blob if it exists
      if (receipt.receiptImage) {
        await del(receipt.receiptImage);
      }
    }

    const data = {
      ...req.body,
      receiptImage: receiptImageUrl,
    };

    const updatedReceipt = await Receipt.findByIdAndUpdate(id, data, {
      new: true,
      runValidators: true,
    });

    res.json(updatedReceipt);
  } catch (err) {
    console.error(err);
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

    // Delete the file from Vercel Blob if it exists
    if (receipt.receiptImage) {
      await del(receipt.receiptImage);
    }

    await Receipt.findByIdAndDelete(id);
    res.json({ message: 'Receipt deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};


