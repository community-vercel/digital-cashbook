// controllers/transactionController.js
const Transaction = require('../models/Transaction');
const Customer = require('../models/Customer');
const { put, del } = require('@vercel/blob');
const mongoose = require('mongoose');
const { generateDailyReport } = require('../utils/generateDailyReport');
const Setting = require('../models/Setting');
const Shop=require('../models/Shop');
exports.addTransaction = async (req, res) => {
  const { customerId, customerName, phone, totalAmount, payable, receivable, description, category, type, isRecurring, date, dueDate, transactionType, shopId } = req.body;
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

    // Determine shopId based on user role
    let selectedShopId = req.user.shopId;
    if (req.user.role === 'superadmin' && shopId) {
      if (!mongoose.Types.ObjectId.isValid(shopId)) {
        return res.status(400).json({ message: 'Invalid shopId' });
      }
      selectedShopId = shopId;
    }
    if (!selectedShopId) {
      return res.status(400).json({ message: 'Shop ID required' });
    }

    // Handle file upload to Vercel Blob
    if (req.files && req.files.image) {
      const file = req.files.image;
      const fileName = `${Date.now()}-${file.name}`;
      const { url } = await put(`transactions/${fileName}`, file.data, {
        access: 'public',
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      transactionImage = url;
    }

    let customer;
    if (customerId) {
      customer = await Customer.findOne({ _id: customerId, shopId: selectedShopId });
      if (!customer) {
        return res.status(404).json({ message: 'Customer not found for this shop' });
      }
    } else if (customerName) {
      customer = await Customer.findOne({ userId: req.user.id, name: customerName, shopId: selectedShopId });
      if (!customer) {
        customer = new Customer({ userId: req.user.id, name: customerName, phone, shopId: selectedShopId });
        await customer.save();
      }
    } else {
      return res.status(400).json({ message: 'Customer ID or name required' });
    }

    const currentTimestamp = new Date();
    let transactionDate = currentTimestamp;
    if (date) {
      const providedDate = new Date(date);
      if (!isNaN(providedDate)) {
        transactionDate = new Date(
          providedDate.getFullYear(),
          providedDate.getMonth(),
          providedDate.getDate(),
          currentTimestamp.getHours(),
          currentTimestamp.getMinutes(),
          currentTimestamp.getSeconds(),
          currentTimestamp.getMilliseconds()
        );
      }
    }

    const transaction = new Transaction({
      userId: req.user.id || req.user.userId,
      customerId: customer._id,
      shopId: selectedShopId,
      totalAmount,
      payable: transactionType === 'payable' ? payable : 0,
      receivable: transactionType === 'receivable' ? receivable : 0,
      description,
      category,
      type,
      isRecurring,
      transactionImage,
      transactionType,
      date: transactionDate,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      createdAt: currentTimestamp,
    });
    await transaction.save();

    customer.balance += transactionType === 'receivable' ? parseFloat(receivable) : -parseFloat(payable);
    await customer.save();

    res.json({ transaction, customer });
  } catch (error) {
    console.error('Error in addTransaction:', error);
    res.status(500).json({ message: 'Server error' });
  }
};


exports.getDailyReport = async (req, res) => {
     console.log("data",req.query)

  try {
    const { date, shopId } = req.query;
    if (!date) {
      return res.status(400).json({ message: 'Date is required' });
    }

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    // Determine shopId, prioritizing query parameter for superadmins
    let selectedShopId = null;
    let isAllShops = false;
    if (req.user?.role === 'superadmin') {
      if (shopId) {
        if (shopId === 'all') {
          isAllShops = true;
        } else if (!mongoose.Types.ObjectId.isValid(shopId)) {
          return res.status(400).json({ message: `Invalid shopId: ${shopId}` });
        } else {
          selectedShopId = shopId;
        }
      } else {
        return res.status(400).json({ message: 'Shop ID or "all" required for superadmin' });
      }
    } else {
      selectedShopId = req.user?.shopId;
      if (!selectedShopId) {
        return res.status(400).json({ message: 'Shop ID required for non-superadmin users' });
      }
    }

    console.log('getDailyReport - Shop selection:', {
      userId: req.user?._id,
      userRole: req.user?.role,
      queryShopId: shopId,
      selectedShopId,
      isAllShops,
      date,
    });

    // Validate shop and fetch settings
    let settings = null;
    let currency = 'PKR';
    let openingBalance = 0;
    if (selectedShopId) {
      const shop = await Shop.findById(selectedShopId);
      if (!shop) {
        return res.status(404).json({ message: `Shop not found for shopId: ${selectedShopId}` });
      }
      settings = await Setting.findOne({ shopId: selectedShopId });
      if (!settings) {
        settings = await Setting.create({
          shopId: selectedShopId,
          siteName: shop.name || 'Default Store',
          currency: 'PKR',
          openingBalance: 0,
        });
      }
      openingBalance = Number(settings.openingBalance) || 0;
      currency = settings.currency || 'PKR';
    } else {
      // For "All Shops," aggregate opening balances
      const allSettings = await Setting.find();
      openingBalance = allSettings.reduce((sum, setting) => sum + (Number(setting.openingBalance) || 0), 0);
      settings = { siteName: 'All Shops', currency: 'PKR' };
    }

    // Build transaction query
    const query = {
      date: { $gte: startOfDay, $lte: endOfDay },
    };
    if (selectedShopId) {
      query.shopId = selectedShopId;
    }

    // Fetch transactions
    const transactions = await Transaction.find(query).populate('customerId', 'name').lean();
    console.log('getDailyReport - Transactions fetched:', {
      shopId: selectedShopId || 'all',
      date,
      transactionCount: transactions.length,
      query,
    });

    // Fetch previous transactions for opening balance
    const previousQuery = {
      date: { $lt: startOfDay },
    };
    if (selectedShopId) {
      previousQuery.shopId = selectedShopId;
    }
    const previousTransactions = await Transaction.find(previousQuery).lean();
    console.log('getDailyReport - Previous transactions fetched:', {
      shopId: selectedShopId || 'all',
      previousTransactionCount: previousTransactions.length,
    });

    // Recalculate opening balance with previous transactions
    if (previousTransactions.length > 0) {
      const openingReceivables = previousTransactions
        .filter((t) => t.transactionType === 'receivable')
        .reduce((sum, t) => sum + (Number(t.receivable) || 0), 0);
      const openingPayables = previousTransactions
        .filter((t) => t.transactionType === 'payable')
        .reduce((sum, t) => sum + (Number(t.payable) || 0), 0);
      openingBalance += openingReceivables - openingPayables;
    }

    // Calculate daily totals
    const totalPayables = transactions
      .filter((t) => t.transactionType === 'payable')
      .reduce((sum, t) => sum + (Number(t.payable) || 0), 0);
    const totalReceivables = transactions
      .filter((t) => t.transactionType === 'receivable')
      .reduce((sum, t) => sum + (Number(t.receivable) || 0), 0);
    const dailyBalance = totalReceivables - totalPayables;
    const closingBalance = openingBalance + dailyBalance;

    console.log('getDailyReport - Summary:', {
      shopId: selectedShopId || 'all',
      openingBalance,
      totalPayables,
      totalReceivables,
      dailyBalance,
      closingBalance,
      currency,
    });

    res.json({
      date,
      transactions,
      summary: {
        openingBalance,
        totalPayables,
        totalReceivables,
        dailyBalance,
        closingBalance,
        currency,
      },
      shopName: settings.siteName || 'All Shops',
    });
  } catch (error) {
    console.error('Error in getDailyReport:', {
      message: error.message,
      stack: error.stack,
      userId: req.user?._id,
      shopId: req.query.shopId,
      date: req.query.date,
    });
    res.status(500).json({ message: `Server error: ${error.message}` });
  }
};

exports.generateDailyReportPdf = async (req, res) => {
  try {
    const { date, shopId } = req.query;
    const reportDate = new Date(date);
   

    if (isNaN(reportDate.getTime())) {
      return res.status(400).json({ message: 'Invalid date format' });
    }

    // Determine shopId, prioritizing query parameter for superadmins
    let selectedShopId = null;
    if (req.user?.role === 'superadmin') {
      if (shopId) {
        if (shopId === 'all') {
          // No selectedShopId for "all"
        } else if (!mongoose.Types.ObjectId.isValid(shopId)) {
          return res.status(400).json({ message: `Invalid shopId: ${shopId}` });
        } else {
          selectedShopId = shopId;
        }
      } else {
        return res.status(400).json({ message: 'Shop ID or "all" required for superadmin' });
      }
    } else {
      selectedShopId = req.user?.shopId;
      if (!selectedShopId) {
        return res.status(400).json({ message: 'Shop ID required for non-superadmin users' });
      }
    }

    console.log('generateDailyReportPdf - Shop selection:', {
      userId: req.user?._id,
      userRole: req.user?.role,
      queryShopId: shopId,
      selectedShopId,
      date,
    });

    const blobUrl = await generateDailyReport(reportDate, selectedShopId);
    res.json({ url: blobUrl });
  } catch (error) {
    console.error('Error in generateDailyReportPdf:', {
      message: error.message,
      stack: error.stack,
      userId: req.user?._id,
      shopId: req.query.shopId,
      date: req.query.date,
    });
    res.status(500).json({ message: `Server error: ${error.message}` });
  }
};
// controllers/transactionController.js
// Fixed getUserTransactions function
exports.getUserTransactions = async (req, res) => {
  try {
    const { startDate, endDate, category, customerId, transactionType, page = 1, limit = 10, shopId } = req.query;
    const query = { userId: req.user.id };

    // Determine shopId - Handle 'all' case properly
    if (req.user.role === 'superadmin') {
      if (shopId && shopId !== 'all') {
        // Validate shopId only if it's not 'all'
        if (!mongoose.Types.ObjectId.isValid(shopId)) {
          return res.status(400).json({ message: 'Invalid shopId' });
        }
        query.shopId = shopId;
      }
      // If shopId is 'all' or not provided, don't add shopId filter (fetch from all shops)
    } else {
      // For non-superadmin users, use their assigned shopId
      const selectedShopId = req.user.shopId;
      if (!selectedShopId) {
        return res.status(400).json({ message: 'Shop ID required' });
      }
      query.shopId = selectedShopId;
    }

    // Apply date filters
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ message: 'Invalid startDate or endDate format' });
      }
      query.date = { $gte: start, $lte: end };
    }

    // Apply other filters
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

    console.log('getUserTransactions query:', query);
    console.log('Total transactions found:', totalItems);

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

// Fixed getTransactions function (similar fix)
exports.getTransactions = async (req, res) => {
  try {
    const { startDate, endDate, category, customerId, transactionType, page = 1, limit = 10, shopId } = req.query;
    const query = {};

    // Determine shopId - Handle 'all' case properly
    if (req.user.role === 'superadmin') {
      if (shopId && shopId !== 'all') {
        // Validate shopId only if it's not 'all'
        if (!mongoose.Types.ObjectId.isValid(shopId)) {
          return res.status(400).json({ message: 'Invalid shopId' });
        }
        query.shopId = shopId;
      }
      // If shopId is 'all' or not provided, don't add shopId filter (fetch from all shops)
    } else {
      // For non-superadmin users, use their assigned shopId
      const selectedShopId = req.user.shopId;
      if (!selectedShopId) {
        return res.status(400).json({ message: 'Shop ID required' });
      }
      query.shopId = selectedShopId;
    }

    // Apply date filters
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ message: 'Invalid startDate or endDate format' });
      }
      query.date = { $gte: start, $lte: end };
    }

    // Apply other filters
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

    console.log('getTransactions query:', query);
    console.log('Total transactions found:', totalItems);

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

// Fixed addTransaction function


exports.updateTransaction = async (req, res) => {
  try {
    const { shopId, transactionType, totalAmount, payable, receivable } = req.body;
    let transactionImage = req.body.transactionImage;

    // Determine shopId
    let selectedShopId = req.user.shopId;
    if (req.user.role === 'superadmin' && shopId) {
      if (!mongoose.Types.ObjectId.isValid(shopId)) {
        return res.status(400).json({ message: 'Invalid shopId' });
      }
      selectedShopId = shopId;
    }
    if (!selectedShopId) {
      return res.status(400).json({ message: 'Shop ID required' });
    }

    if (req.files && req.files.transactionImage) {
      const file = req.files.transactionImage;
      const fileName = `${Date.now()}-${file.name}`;
      const { url } = await put(`transactions/${fileName}`, file.data, {
        access: 'public',
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      transactionImage = url;

      const existingTransaction = await Transaction.findById(req.params.id);
      if (existingTransaction.transactionImage) {
        await del(existingTransaction.transactionImage, {
          token: process.env.BLOB_READ_WRITE_TOKEN,
        });
      }
    }

    const transaction = await Transaction.findOneAndUpdate(
      { _id: req.params.id, shopId: selectedShopId },
      {
        ...req.body,
        totalAmount,
        payable: transactionType === 'payable' ? payable : 0,
        receivable: transactionType === 'receivable' ? receivable : 0,
        transactionImage,
        date: req.body.date || Date.now(),
        dueDate: req.body.dueDate || null,
      },
      { new: true }
    ).populate('customerId', 'name');

    if (!transaction) return res.status(404).json({ message: 'Transaction not found' });

    const customer = await Customer.findById(transaction.customerId);
    if (customer) {
      const oldTransaction = await Transaction.findById(req.params.id);
      const balanceAdjustment =
        (oldTransaction.transactionType === 'receivable' ? -oldTransaction.receivable : oldTransaction.payable) +
        (transactionType === 'receivable' ? parseFloat(receivable || 0) : -parseFloat(payable || 0));
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
    const selectedShopId = req.user.shopId;
    if (!selectedShopId) {
      return res.status(400).json({ message: 'Shop ID required' });
    }

    const transaction = await Transaction.findOneAndDelete({ _id: req.params.id, shopId: selectedShopId });
    if (!transaction) return res.status(404).json({ message: 'Transaction not found' });

    const customer = await Customer.findById(transaction.customerId);
    if (customer) {
      customer.balance += transaction.transactionType === 'receivable' ? -transaction.receivable : transaction.payable;
      await customer.save();
    }

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
    const { transactionType, shopId } = req.query;
    const query = { userId: req.user.id, isRecurring: true };

    let selectedShopId = req.user.shopId;
    if (req.user.role === 'superadmin' && shopId) {
      if (!mongoose.Types.ObjectId.isValid(shopId)) {
        return res.status(400).json({ message: 'Invalid shopId' });
      }
      selectedShopId = shopId;
    }
    if (!selectedShopId) {
      return res.status(400).json({ message: 'Shop ID required' });
    }
    query.shopId = selectedShopId;

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