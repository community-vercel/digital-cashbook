// controllers/transactionController.js
const Transaction = require('../models/Transaction');
const Customer = require('../models/Customer');
const { put, del } = require('@vercel/blob');
const mongoose = require('mongoose');
const { generateDailyReport } = require('../utils/generateDailyReport'); // Destructure the function

exports.addTransaction = async (req, res) => {
  const { customerId, customerName, phone, totalAmount, payable, receivable, description, category, type, isRecurring, date, dueDate, user, transactionType } = req.body;
  let transactionImage = null;

  try {
    // Validate transactionType
    if (!['payable', 'receivable'].includes(transactionType)) {
      return res.status(400).json({ message: 'Invalid transaction type. Must be "payable" or "receivable"' });
    }

    // Validate amounts
    if (isNaN(totalAmount) || (transactionType === 'payable' && isNaN(payable)) || (transactionType === 'receivable' && isNaN(receivable))) {
      return res.status(400).json({ message: 'Invalid amount fields' });
    }

    // Handle file upload to Vercel Blob
    if (req.files && req.files.transactionImage) {
      const file = req.files.transactionImage;
      const fileName = `${Date.now()}-${file.name}`;
      const { url } = await put(`transactions/${fileName}`, file.data, {
        access: 'public',
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      transactionImage = url;
    }

    let customer;
    if (customerId) {
      customer = await Customer.findById(customerId);
      if (!customer) {
        return res.status(404).json({ message: 'Customer not found' });
      }
    } else if (customerName) {
      customer = await Customer.findOne({ userId: req.user.id, name: customerName });
      if (!customer) {
        customer = new Customer({ userId: req.user.id, name: customerName, phone });
        await customer.save();
      }
    } else {
      return res.status(400).json({ message: 'Customer ID or name required' });
    }

    const transaction = new Transaction({
      userId: user || req.user.id,
      customerId: customer._id,
      totalAmount,
      payable: transactionType === 'payable' ? payable : 0,
      receivable: transactionType === 'receivable' ? receivable : 0,
      description,
      category,
      type,
      isRecurring,
      transactionImage,
      transactionType,
      date: date || Date.now(),
      dueDate: dueDate || null,
    });
    await transaction.save();

    // Update customer balance based on transaction type
    customer.balance += transactionType === 'receivable' ? parseFloat(receivable) : -parseFloat(payable);
    await customer.save();

    res.json({ transaction, customer });
  } catch (error) {
    console.error('Error in addTransaction:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
// controllers/transactionController.js
// controllers/transactionController.js
exports.getDailyReport = async (req, res) => {
  try {
    const { date } = req.query;
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const transactions = await Transaction.find({
      date: { $gte: startOfDay, $lte: endOfDay },
    }).populate('customerId', 'name');

    const previousTransactions = await Transaction.find({
      date: { $lt: startOfDay },
    });

      let openingBalance = 0;
    if (previousTransactions.length > 0) {
      const openingReceivables = previousTransactions
        .filter((t) => t.transactionType === 'receivable')
        .reduce((sum, t) => sum + (typeof t.receivable === 'number' && !isNaN(t.receivable) ? t.receivable : 0), 0);
      const openingPayables = previousTransactions
        .filter((t) => t.transactionType === 'payable')
        .reduce((sum, t) => sum + (typeof t.payable === 'number' && !isNaN(t.payable) ? t.payable : 0), 0);
      openingBalance = openingReceivables - openingPayables;
    } else {
      // Use stored opening balance if no prior transactions
      openingBalance = settings.openingBalance !== null ? settings.openingBalance : 0;
    }
    const totalPayables = transactions
      .filter((t) => t.transactionType === 'payable')
      .reduce((sum, t) => sum + t.payable, 0);
    const totalReceivables = transactions
      .filter((t) => t.transactionType === 'receivable')
      .reduce((sum, t) => sum + t.receivable, 0);
    const dailyBalance = totalReceivables - totalPayables;

    const closingBalance = openingBalance + dailyBalance;

    res.json({
      date,
      transactions,
      summary: {
        openingBalance,
        totalPayables,
        totalReceivables,
        dailyBalance,
        closingBalance,
      },
    });
  } catch (error) {
    console.error('Error in getDailyReport:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.generateDailyReportPdf = async (req, res) => {
  try {
    const { date } = req.query;
    const reportDate = new Date(date);

    if (isNaN(reportDate.getTime())) {
      return res.status(400).json({ message: 'Invalid date format' });
    }

    const blobUrl = await generateDailyReport(reportDate);
    res.json({ url: blobUrl });
  } catch (error) {
    console.error('Error in generateDailyReportPdf:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
exports.getTransactions = async (req, res) => {
  try {
    const { startDate, endDate, category, customerId, transactionType, page = 1, limit = 10 } = req.query;
    const query = {};

    // Filter by timestamp range
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ message: 'Invalid startDate or endDate format' });
      }

      query.date = { $gte: start, $lte: end };
    }

    // Filter by category
    if (category) query.category = category;

    // Filter by customerId
    if (customerId) {
      if (!mongoose.Types.ObjectId.isValid(customerId)) {
        return res.status(400).json({ message: 'Invalid customerId' });
      }
      query.customerId = customerId;
    }

    // Filter by transactionType
    if (transactionType && ['payable', 'receivable'].includes(transactionType)) {
      query.transactionType = transactionType;
    }

    // Pagination
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    const [transactions, totalItems] = await Promise.all([
      Transaction.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate('customerId', 'name'),
      Transaction.countDocuments(query),
    ]);

    const totalPages = Math.ceil(totalItems / limitNum);

    res.json({
      transactions,
      pagination: {
        currentPage: pageNum,
        itemsPerPage: limitNum,
        totalItems,
        totalPages,
      },
    });
  } catch (error) {
    console.error('Error in getTransactions:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getUserTransactions = async (req, res) => {
  try {
    const { startDate, endDate, category, customerId, transactionType, page = 1, limit = 10 } = req.query;
    const query = { userId: req.user.id };

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ message: 'Invalid startDate or endDate format' });
      }

      query.date = { $gte: start, $lte: end };
    }

    if (category) query.category = category;
    if (customerId) {
      if (!mongoose.Types.ObjectId.isValid(customerId)) {
        return res.status(400).json({ message: 'Invalid customerId' });
      }
      query.customerId = customerId;
    }
    if (transactionType && ['payable', 'receivable'].includes(transactionType)) {
      query.transactionType = transactionType;
    }

    // Pagination
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    const [transactions, totalItems] = await Promise.all([
      Transaction.find(query)
        .sort({ date: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate('customerId', 'name'),
      Transaction.countDocuments(query),
    ]);

    const totalPages = Math.ceil(totalItems / limitNum);

    res.json({
      transactions,
      pagination: {
        currentPage: pageNum,
        itemsPerPage: limitNum,
        totalItems,
        totalPages,
      },
    });
  } catch (error) {
    console.error('Error in getUserTransactions:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.updateTransaction = async (req, res) => {
  try {
    let transactionImage = req.body.transactionImage;
    if (req.files && req.files.transactionImage) {
      const file = req.files.transactionImage;
      const fileName = `${Date.now()}-${file.name}`;
      const { url } = await put(`transactions/${fileName}`, file.data, {
        access: 'public',
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      transactionImage = url;

      // Delete old image from Vercel Blob if it exists
      const existingTransaction = await Transaction.findById(req.params.id);
      if (existingTransaction.transactionImage) {
        await del(existingTransaction.transactionImage, {
          token: process.env.BLOB_READ_WRITE_TOKEN,
        });
      }
    }

    const transaction = await Transaction.findOneAndUpdate(
      { _id: req.params.id },
      {
        ...req.body,
        totalAmount: req.body.totalAmount,
        payable: req.body.transactionType === 'payable' ? req.body.payable : 0,
        receivable: req.body.transactionType === 'receivable' ? req.body.receivable : 0,
        transactionImage,
        date: req.body.date || Date.now(),
        dueDate: req.body.dueDate || null,
      },
      { new: true }
    ).populate('customerId', 'name');

    if (!transaction) return res.status(404).json({ message: 'Transaction not found' });

    // Update customer balance
    const customer = await Customer.findById(transaction.customerId);
    if (customer) {
      const oldTransaction = await Transaction.findById(req.params.id);
      const balanceAdjustment =
        (oldTransaction.transactionType === 'receivable' ? -oldTransaction.receivable : oldTransaction.payable) +
        (req.body.transactionType === 'receivable' ? parseFloat(req.body.receivable || 0) : -parseFloat(req.body.payable || 0));
      customer.balance += balanceAdjustment;
      await customer.save();
    }

    res.json(transaction);
  } catch (error) {
    console.error('Error in updateTransaction:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.deleteTransaction = async (req, res) => {
  try {
    const transaction = await Transaction.findOneAndDelete({ _id: req.params.id });
    if (!transaction) return res.status(404).json({ message: 'Transaction not found' });

    // Update customer balance
    const customer = await Customer.findById(transaction.customerId);
    if (customer) {
      customer.balance += transaction.transactionType === 'receivable' ? -transaction.receivable : transaction.payable;
      await customer.save();
    }

    // Delete image from Vercel Blob if it exists
    if (transaction.transactionImage) {
      await del(transaction.transactionImage, {
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
    }

    res.json({ message: 'Transaction deleted' });
  } catch (error) {
    console.error('Error in deleteTransaction:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getRecurringSuggestions = async (req, res) => {
  try {
    const { transactionType } = req.query;
    const query = { userId: req.user.id, isRecurring: true };

    if (transactionType && ['payable', 'receivable'].includes(transactionType)) {
      query.transactionType = transactionType;
    }

    const recurringTransactions = await Transaction.find(query)
      .select('description category type totalAmount payable receivable transactionType dueDate');
    res.json(recurringTransactions);
  } catch (error) {
    console.error('Error in getRecurringSuggestions:', error);
    res.status(500).json({ message: 'Server error' });
  }
};