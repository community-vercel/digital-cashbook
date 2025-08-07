const Transaction = require('../models/Transaction');
const Customer = require('../models/Customer');
const { put, del } = require('@vercel/blob');
const mongoose = require('mongoose');
const { generateDailyReport } = require('../utils/generateDailyReport');
const Setting = require('../models/Setting');
const Shop = require('../models/Shop');
const determineShopContext = (user, requestShopId = null) => {
  let selectedShopId = null;
  let isAllShops = false;

  if (user.role === 'superadmin') {
    if (requestShopId) {
      if (requestShopId === 'all') {
        isAllShops = true;
      } else if (mongoose.Types.ObjectId.isValid(requestShopId)) {
        selectedShopId = requestShopId;
      } else {
        throw new Error('Invalid shopId format');
      }
    } else {
      isAllShops = true;
    }
  } else {
    selectedShopId = user.shopId;
    if (!selectedShopId) {
      throw new Error('Shop ID required for non-superadmin users');
    }
  }

  return { selectedShopId, isAllShops };
};

const validateShopAccess = async (user, shopId) => {
  if (!shopId) return null;
  
  const shop = await Shop.findById(shopId);
  if (!shop) {
    throw new Error(`Shop not found: ${shopId}`);
  }
  
  return shop;
};

exports.addTransaction = async (req, res) => {
  const { 
    customerId, 
    customerName, 
    phone, 
    totalAmount, 
    payable, 
    receivable, 
    description, 
    category, 
    type, 
    isRecurring, 
    date, 
    dueDate, 
    transactionType, 
    shopId 
  } = req.body;
  
  let transactionImage = null;

  try {
    // Extract userId properly
    const userId = req.user?.userId || req.user?.id || req.user?._id;
    
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(401).json({ message: 'Valid user ID not found in request' });
    }

    console.log("Extracted userId:", userId);

    // Validate transaction type
    if (!['payable', 'receivable'].includes(transactionType)) {
      return res.status(400).json({ 
        message: 'Invalid transaction type. Must be "payable" or "receivable"' 
      });
    }

    // Validate amounts
    const parsedTotalAmount = parseFloat(totalAmount);
    const parsedPayable = parseFloat(payable || 0);
    const parsedReceivable = parseFloat(receivable || 0);
    
    if (isNaN(parsedTotalAmount) || parsedTotalAmount <= 0) {
      return res.status(400).json({ message: 'Valid total amount is required' });
    }
    
    if (transactionType === 'payable' && (isNaN(parsedPayable) || parsedPayable <= 0)) {
      return res.status(400).json({ message: 'Valid payable amount is required' });
    }
    
    if (transactionType === 'receivable' && (isNaN(parsedReceivable) || parsedReceivable <= 0)) {
      return res.status(400).json({ message: 'Valid receivable amount is required' });
    }

    // Determine shop context
    const { selectedShopId } = determineShopContext(req.user, shopId);
    
    if (!selectedShopId) {
      return res.status(400).json({ message: 'Shop ID is required for transaction creation' });
    }

    // Validate shop access
    const shop = await validateShopAccess(req.user, selectedShopId);
    if (!shop) {
      return res.status(404).json({ message: 'Shop not found' });
    }

    // Handle file upload to Vercel Blob
    if (req.files && req.files.image) {
      try {
        const file = req.files.image;
        const fileName = `transactions/${selectedShopId}/${Date.now()}-${file.name}`;
        const { url } = await put(fileName, file.data, {
          access: 'public',
          token: process.env.BLOB_READ_WRITE_TOKEN,
        });
        transactionImage = url;
      } catch (uploadError) {
        console.error('Image upload error:', uploadError);
        return res.status(500).json({ message: 'Failed to upload image' });
      }
    }

    // Handle customer
    let customer;
    if (customerId) {
      // Validate customerId format
      if (!mongoose.Types.ObjectId.isValid(customerId)) {
        return res.status(400).json({ message: 'Invalid customer ID format' });
      }

      customer = await Customer.findOne({ 
        _id: customerId, 
        shopId: selectedShopId 
      });
      console.log("Customer lookup result:", customer);
      if (!customer) {
        return res.status(404).json({ 
          message: 'Customer not found for this shop' 
        });
      }
      // Ensure customer has a valid userId
      if (!customer.userId || !mongoose.Types.ObjectId.isValid(customer.userId)) {
        console.log("Customer missing valid userId, setting to:", userId);
        customer.userId = new mongoose.Types.ObjectId(userId);
      }
    } else if (customerName?.trim()) {
      // Find existing customer or create new one
      customer = await Customer.findOne({ 
        name: { $regex: new RegExp(`^${customerName.trim()}$`, 'i') },
        shopId: selectedShopId 
      });
      
      if (!customer) {
        console.log("Creating new customer with userId:", userId);
        customer = new Customer({ 
          userId: new mongoose.Types.ObjectId(userId), // Ensure ObjectId
          name: customerName.trim(), 
          phone: phone?.trim() || '', 
          shopId: new mongoose.Types.ObjectId(selectedShopId),
          balance: 0
        });
        await customer.save();
        console.log("New customer created:", customer._id);
      }
    } else {
      return res.status(400).json({ message: 'Customer ID or name is required' });
    }

    // Prepare transaction date
    const currentTimestamp = new Date();
    let transactionDate = currentTimestamp;
    
    if (date) {
      const providedDate = new Date(date);
      if (!isNaN(providedDate.getTime())) {
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

    // Create transaction
    console.log("Creating transaction with userId:", userId);
    const transaction = new Transaction({
      userId: new mongoose.Types.ObjectId(userId), // Ensure ObjectId
      customerId: customer._id,
      shopId: new mongoose.Types.ObjectId(selectedShopId),
      totalAmount: parsedTotalAmount,
      payable: transactionType === 'payable' ? parsedPayable : 0,
      receivable: transactionType === 'receivable' ? parsedReceivable : 0,
      description: description?.trim() || '',
      category: category?.trim() || 'Other',
      type: type || 'Cash',
      isRecurring: Boolean(isRecurring),
      transactionImage,
      transactionType,
      date: transactionDate,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      createdAt: currentTimestamp,
    });

    await transaction.save();
    console.log("Transaction created successfully:", transaction._id);

    // Update customer balance
    const balanceChange = transactionType === 'receivable' 
      ? parsedReceivable 
      : -parsedPayable;
    
    console.log("Updating customer balance:", customer.balance, "with change:", balanceChange, "for customer:", customer._id);
    customer.balance = (customer.balance || 0) + balanceChange;
    
    // Explicitly set userId before saving to avoid validation error
    customer.userId = new mongoose.Types.ObjectId(userId);
    await customer.save({ validateModifiedOnly: true }); // Only validate modified fields
    console.log("Customer balance updated:", customer.balance);

    // Populate the transaction for response
    await transaction.populate('customerId', 'name phone balance');

    res.status(201).json({ 
      message: 'Transaction created successfully',
      transaction,
      customer: {
        _id: customer._id,
        name: customer.name,
        balance: customer.balance
      }
    });

  } catch (error) {
    console.error('Error in addTransaction:', error);
    
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => ({
        field: err.path,
        message: err.message,
        value: err.value
      }));
      
      return res.status(400).json({ 
        message: 'Validation error', 
        errors: validationErrors,
        debug: {
          userId: req.user?.userId || req.user?.id || req.user?._id || 'undefined',
          reqUser: req.user,
          customerId,
          customerName,
          shopId
        }
      });
    }
    
    res.status(500).json({ 
      message: 'Server error', 
      error: error.message,
      debug: process.env.NODE_ENV === 'development' ? {
        userId: req.user?.userId || req.user?.id || req.user?._id || 'undefined',
        reqUser: req.user,
        customerId,
        customerName,
        shopId
      } : undefined
    });
  }
};

// exports.addTransaction = async (req, res) => {
//   const { customerId, customerName, phone, totalAmount, payable, receivable, description, category, type, isRecurring, date, dueDate, transactionType, shopId } = req.body;
//   let transactionImage = null;

//   try {
//     // Validate transactionType
//     if (!['payable', 'receivable'].includes(transactionType)) {
//       return res.status(400).json({ message: 'Invalid transaction type. Must be "payable" or "receivable"' });
//     }

//     // Validate amounts
//     if (isNaN(totalAmount) || (transactionType === 'payable' && isNaN(payable)) || (transactionType === 'receivable' && isNaN(receivable))) {
//       return res.status(400).json({ message: 'Invalid amount fields' });
//     }

//     // Determine shopId based on user role
//     let selectedShopId = req.user.shopId;
//     if (req.user.role === 'superadmin' && shopId) {
//       if (!mongoose.Types.ObjectId.isValid(shopId)) {
//         return res.status(400).json({ message: 'Invalid shopId' });
//       }
//       selectedShopId = shopId;
//     }
//     if (!selectedShopId) {
//       return res.status(400).json({ message: 'Shop ID required' });
//     }

//     // Handle file upload to Vercel Blob
//     if (req.files && req.files.image) {
//       const file = req.files.image;
//       const fileName = `${Date.now()}-${file.name}`;
//       const { url } = await put(`transactions/${fileName}`, file.data, {
//         access: 'public',
//         token: process.env.BLOB_READ_WRITE_TOKEN,
//       });
//       transactionImage = url;
//     }

//     let customer;
//     if (customerId) {
//       customer = await Customer.findOne({ _id: customerId, shopId: selectedShopId });
//       if (!customer) {
//         return res.status(404).json({ message: 'Customer not found for this shop' });
//       }
//     } else if (customerName) {
//       customer = await Customer.findOne({ userId: req.user.id, name: customerName, shopId: selectedShopId });
//       if (!customer) {
//         customer = new Customer({ userId: req.user.id, name: customerName, phone, shopId: selectedShopId });
//         await customer.save();
//       }
//     } else {
//       return res.status(400).json({ message: 'Customer ID or name required' });
//     }

//     const currentTimestamp = new Date();
//     let transactionDate = currentTimestamp;
//     if (date) {
//       const providedDate = new Date(date);
//       if (!isNaN(providedDate)) {
//         transactionDate = new Date(
//           providedDate.getFullYear(),
//           providedDate.getMonth(),
//           providedDate.getDate(),
//           currentTimestamp.getHours(),
//           currentTimestamp.getMinutes(),
//           currentTimestamp.getSeconds(),
//           currentTimestamp.getMilliseconds()
//         );
//       }
//     }

//     const transaction = new Transaction({
//       userId: req.user.id || req.user.userId,
//       customerId: customer._id,
//       shopId: selectedShopId,
//       totalAmount,
//       payable: transactionType === 'payable' ? payable : 0,
//       receivable: transactionType === 'receivable' ? receivable : 0,
//       description,
//       category,
//       type,
//       isRecurring,
//       transactionImage,
//       transactionType,
//       date: transactionDate,
//       dueDate: dueDate ? new Date(dueDate) : undefined,
//       createdAt: currentTimestamp,
//     });
//     await transaction.save();

//     customer.balance += transactionType === 'receivable' ? parseFloat(receivable) : -parseFloat(payable);
//     await customer.save();

//     res.json({ transaction, customer });
//   } catch (error) {
//     console.error('Error in addTransaction:', error);
//     res.status(500).json({ message: 'Server error' });
//   }
// };


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
      userId: req.user?._id || req.user.userId,
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
    const query = { userId: req.user.id || req.user.userId };

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

// controllers/transactionController.js - Fixed updateTransaction and deleteTransaction functions

exports.updateTransaction = async (req, res) => {
  try {
    const { shopId, transactionType, totalAmount, payable, receivable, customerId } = req.body;
    let transactionImage = req.body.transactionImage;

    // Validate transactionType
    if (!['payable', 'receivable'].includes(transactionType)) {
      return res.status(400).json({ message: 'Invalid transaction type. Must be "payable" or "receivable"' });
    }

    // Validate amounts
    if (isNaN(totalAmount) || (transactionType === 'payable' && isNaN(payable)) || (transactionType === 'receivable' && isNaN(receivable))) {
      return res.status(400).json({ message: 'Invalid amount fields' });
    }

    // Determine shopId based on user role - FIXED
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

    // Get the existing transaction to check shop ownership - ADDED
    const existingTransaction = await Transaction.findById(req.params.id);
    if (!existingTransaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    // Verify the transaction belongs to the correct shop - ADDED
    if (existingTransaction.shopId.toString() !== selectedShopId.toString()) {
      return res.status(403).json({ message: 'Access denied: Transaction belongs to a different shop' });
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

      // Delete old image if it exists
      if (existingTransaction.transactionImage) {
        try {
          await del(existingTransaction.transactionImage, {
            token: process.env.BLOB_READ_WRITE_TOKEN,
          });
        } catch (deleteError) {
          console.error('Error deleting old image:', deleteError);
          // Continue with update even if image deletion fails
        }
      }
    }

    // Validate customer belongs to the same shop - ADDED
    if (customerId) {
      const customer = await Customer.findOne({ _id: customerId, shopId: selectedShopId });
      if (!customer) {
        return res.status(404).json({ message: 'Customer not found for this shop' });
      }
    }

    // Store old transaction values for balance adjustment - MOVED UP
    const oldTransactionType = existingTransaction.transactionType;
    const oldPayable = existingTransaction.payable || 0;
    const oldReceivable = existingTransaction.receivable || 0;

    // Update the transaction - FIXED query to include shopId
    const transaction = await Transaction.findOneAndUpdate(
      { _id: req.params.id, shopId: selectedShopId }, // FIXED: Added shopId filter
      {
        ...req.body,
        shopId: selectedShopId, // Ensure shopId is maintained
        totalAmount: parseFloat(totalAmount),
        payable: transactionType === 'payable' ? parseFloat(payable || 0) : 0,
        receivable: transactionType === 'receivable' ? parseFloat(receivable || 0) : 0,
        transactionImage: transactionImage || existingTransaction.transactionImage,
        transactionType,
        date: req.body.date || existingTransaction.date,
        dueDate: req.body.dueDate || existingTransaction.dueDate,
      },
      { new: true }
    ).populate('customerId', 'name');

    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found or access denied' });
    }

    // Update customer balance - FIXED calculation
    const customer = await Customer.findOne({ _id: transaction.customerId._id, shopId: selectedShopId });
    if (customer) {
      // Reverse the old transaction's effect on balance
      const oldBalanceEffect = oldTransactionType === 'receivable' ? oldReceivable : -oldPayable;
      
      // Apply the new transaction's effect on balance
      const newBalanceEffect = transactionType === 'receivable' ? parseFloat(receivable || 0) : -parseFloat(payable || 0);
      
      // Net adjustment = new effect - old effect
      const balanceAdjustment = newBalanceEffect - oldBalanceEffect;
      
      customer.balance += balanceAdjustment;
      await customer.save();
    }

    res.json({
      message: 'Transaction updated successfully',
      transaction,
      customer: customer ? { _id: customer._id, name: customer.name, balance: customer.balance } : null
    });
  } catch (error) {
    console.error('Error in updateTransaction:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.deleteTransaction = async (req, res) => {
  try {
    // Determine shopId based on user role - FIXED
    let selectedShopId = req.user.shopId;
    if (req.user.role === 'superadmin') {
      // For superadmin, we need to get the transaction first to find its shopId
      const transactionToDelete = await Transaction.findById(req.params.id);
      if (!transactionToDelete) {
        return res.status(404).json({ message: 'Transaction not found' });
      }
      selectedShopId = transactionToDelete.shopId;
    }

    if (!selectedShopId) {
      return res.status(400).json({ message: 'Shop ID required' });
    }

    // Delete the transaction with shop validation - FIXED
    const transaction = await Transaction.findOneAndDelete({ 
      _id: req.params.id, 
      shopId: selectedShopId 
    });

    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found or access denied' });
    }

    // Update customer balance - FIXED to validate shop ownership
    const customer = await Customer.findOne({ _id: transaction.customerId, shopId: selectedShopId });
    if (customer) {
      // Reverse the transaction's effect on customer balance
      const balanceAdjustment = transaction.transactionType === 'receivable' 
        ? -(transaction.receivable || 0)  // Subtract receivable 
        : (transaction.payable || 0);     // Add back payable
      
      customer.balance += balanceAdjustment;
      await customer.save();
    }

    // Delete transaction image if exists
    if (transaction.transactionImage) {
      try {
        await del(transaction.transactionImage, {
          token: process.env.BLOB_READ_WRITE_TOKEN,
        });
      } catch (deleteError) {
        console.error('Error deleting transaction image:', deleteError);
        // Continue even if image deletion fails
      }
    }

    res.json({ 
      message: 'Transaction deleted successfully',
      deletedTransaction: {
        _id: transaction._id,
        description: transaction.description,
        totalAmount: transaction.totalAmount
      }
    });
  } catch (error) {
    console.error('Error in deleteTransaction:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// BONUS: Add a function to verify transaction ownership (can be used as middleware)
exports.verifyTransactionOwnership = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Determine shopId based on user role
    let selectedShopId = req.user.shopId;
    if (req.user.role === 'superadmin') {
      // Superadmin can access transactions from any shop, but we still validate existence
      const transaction = await Transaction.findById(id);
      if (!transaction) {
        return res.status(404).json({ message: 'Transaction not found' });
      }
      selectedShopId = transaction.shopId;
    }

    if (!selectedShopId) {
      return res.status(400).json({ message: 'Shop ID required' });
    }

    // Verify transaction exists and belongs to the correct shop
    const transaction = await Transaction.findOne({ _id: id, shopId: selectedShopId });
    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found or access denied' });
    }

    // Attach transaction and shopId to request for use in route handlers
    req.transaction = transaction;
    req.selectedShopId = selectedShopId;
    
    next();
  } catch (error) {
    console.error('Error in verifyTransactionOwnership:', error);
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