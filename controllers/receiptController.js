const Receipt = require('../models/Receipt');

const Customer = require('../models/Customer');
const { put, del } = require('@vercel/blob');

exports.addReceipt = async (req, res) => {
  const { customerId, customerName, phone, amount, description, category, type, isRecurring, date,user } = req.body;
  let receiptImage = null;

  try {
    // Handle file upload to Vercel Blob
    if (req.files && req.files.receiptImage) {
      const file = req.files.receiptImage;
      const fileName = `${Date.now()}-${file.name}`;
      const { url } = await put(`receipts/${fileName}`, file.data, {
        access: 'public',
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      receiptImage = url;
    }

    let customer;
    if (customerId) {
      customer = await Customer.findById(customerId);
    
    } else if (customerName) {
      customer = await Customer.findOne({ userId: req.user.id, name: customerName });
      if (!customer) {
        customer = new Customer({ userId: req.user.id, name: customerName, phone });
        await customer.save();
      }
    } else {
      return res.status(400).json({ message: 'Customer ID or name required' });
    }

    const receipt = new Receipt({
      userId: user,
      customerId: customer._id,
      amount,
      description,
      category,
      type,
      isRecurring,
      receiptImage,
      date: date || Date.now(),
    });
    await receipt.save();

    customer.balance += parseFloat(amount);
    await customer.save();

    res.json({ receipt, customer });
  } catch (error) {
    console.error('Error in addReceipt:', error);
    res.status(500).json({ message:     `${error.message}` });
  }
};

exports.getuserReceipts = async (req, res) => {
  try {
    const { startDate, endDate, category, customerId } = req.query;
    const query = { userId: req.user.id };
    if (startDate && endDate) {
      query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }
    if (category) query.category = category;
    if (customerId) query.customerId = customerId;
    const receipts = await Receipt.find(query).sort({ date: -1 }).populate('customerId', 'name');
    res.json(receipts);
  } catch (error) {
    console.error('Error in getReceipts:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getReceipts = async (req, res) => {
  try {
    const { startDate, endDate, category, customerId } = req.query;
    const query = {  };
    if (startDate && endDate) {
      query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }
    if (category) query.category = category;
    if (customerId) query.customerId = customerId;
    const receipts = await Receipt.find(query).sort({ date: -1 }).populate('customerId', 'name');
    res.json(receipts);
  } catch (error) {
    console.error('Error in getReceipts:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.updateReceipt = async (req, res) => {
  try {
    let receiptImage = req.body.receiptImage;
    if (req.files && req.files.receiptImage) {
      const file = req.files.receiptImage;
      const fileName = `${Date.now()}-${file.name}`;
      const { url } = await put(`receipts/${fileName}`, file.data, {
        access: 'public',
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      receiptImage = url;

      // Delete old image from Vercel Blob if it exists
      const existingReceipt = await Receipt.findById(req.params.id);
      if (existingReceipt.receiptImage) {
        await del(existingReceipt.receiptImage, {
          token: process.env.BLOB_READ_WRITE_TOKEN,
        });
      }
    }

    const receipt = await Receipt.findOneAndUpdate(
      { _id: req.params.id },
      { ...req.body, receiptImage, date: req.body.date || Date.now() },
      { new: true }
    ).populate('customerId', 'name');
    if (!receipt) return res.status(404).json({ message: 'Receipt not found' });
    res.json(receipt);
  } catch (error) {
    console.error('Error in updateReceipt:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.deleteReceipt = async (req, res) => {
  try {
    const receipt = await Receipt.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    if (!receipt) return res.status(404).json({ message: 'Receipt not found' });

    // Delete image from Vercel Blob if it exists
    if (receipt.receiptImage) {
      await del(receipt.receiptImage, {
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
    }

    res.json({ message: 'Receipt deleted' });
  } catch (error) {
    console.error('Error in deleteReceipt:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getRecurringSuggestions = async (req, res) => {
  try {
    const recurringReceipts = await Receipt.find({
      userId: req.user.id,
      isRecurring: true,
    }).select('description category type amount');
    res.json(recurringReceipts);
  } catch (error) {
    console.error('Error in getRecurringSuggestions:', error);
    res.status(500).json({ message: 'Server error' });
  }
};