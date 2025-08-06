// controllers/dashboardController.js
const Transaction = require('../models/Transaction');
const Setting = require('../models/Setting');
const Shop = require('../models/Shop');
const mongoose = require('mongoose');

const parseUTCDate = (dateString, isEndOfDay = false) => {
  if (!dateString || typeof dateString !== 'string') return null;
  const cleanDateString = dateString.split('T')[0].trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDateString)) {
    throw new Error(`Invalid date format: ${dateString}. Expected YYYY-MM-DD`);
  }
  const timeString = isEndOfDay ? '23:59:59.999Z' : '00:00:00.000Z';
  const date = new Date(`${cleanDateString}T${timeString}`);
  if (isNaN(date.getTime())) throw new Error(`Invalid date: ${dateString}`);
  return date;
};

const getNumericValue = (value, defaultValue = 0) => {
  const num = Number(value);
  return !isNaN(num) ? num : defaultValue;
};

exports.getDashboardData = async (req, res) => {
  try {
    const { startDate, endDate, shopId } = req.query;
    const query = {};

    // Apply shopId filter based on role - Handle 'all' case properly
    if (req.user.role === 'superadmin') {
      if (shopId && shopId !== 'all') {
        // Validate shopId only if it's not 'all'
        if (!mongoose.Types.ObjectId.isValid(shopId)) {
          return res.status(400).json({ message: 'Invalid shopId' });
        }
        query.shopId = shopId;
      }
      // If shopId is 'all' or not provided, don't add shopId filter (fetch from all shops)
    } else if (req.user.shopId) {
      query.shopId = req.user.shopId;
    } else {
      return res.status(400).json({ message: 'Shop ID required' });
    }

    // Fetch settings for opening balance
    let settingsOpeningBalance = 0;
    if (query.shopId) {
      // Specific shop selected
      const settings = await Setting.findOne({ shopId: query.shopId });
      if (!settings) {
        // Create default settings if not found
        const shop = await Shop.findById(query.shopId);
        if (!shop) {
          return res.status(404).json({ error: 'Shop not found' });
        }
        const newSettings = await Setting.create({
          shopId: query.shopId,
          siteName: shop.name || 'Default Store',
          currency: 'PKR',
          openingBalance: 0,
        });
        settingsOpeningBalance = 0;
      } else {
        settingsOpeningBalance = getNumericValue(settings.openingBalance);
      }
    } else {
      // For "All Shops", aggregate opening balances across all shops
      const allSettings = await Setting.find();
      settingsOpeningBalance = allSettings.reduce((sum, setting) => sum + getNumericValue(setting.openingBalance), 0);
    }

    // Apply date filters
    let startDateParsed = null;
    let endDateParsed = null;
    if (startDate || endDate) {
      try {
        if (startDate) startDateParsed = parseUTCDate(startDate, false);
        if (endDate) endDateParsed = parseUTCDate(endDate, true);
        if (startDateParsed && endDateParsed && startDateParsed > endDateParsed) {
          return res.status(400).json({ error: 'Start date cannot be after end date' });
        }
        if (startDateParsed && endDateParsed) {
          query.date = { $gte: startDateParsed, $lte: endDateParsed };
        } else if (startDateParsed) {
          query.date = { $gte: startDateParsed };
        } else if (endDateParsed) {
          query.date = { $lte: endDateParsed };
        }
      } catch (dateError) {
        return res.status(400).json({ error: dateError.message });
      }
    }

    console.log('Dashboard query:', query);
    console.log('ShopId from request:', shopId);
    console.log('User role:', req.user.role);

    // Fetch transactions with customer data
    const transactions = await Transaction.find(query).populate('customerId', 'name');

    console.log('Transactions found:', transactions.length);

    const receivables = transactions.filter(t => t.transactionType === 'receivable');
    const payables = transactions.filter(t => t.transactionType === 'payable');
    const totalReceivables = receivables.reduce((sum, r) => sum + getNumericValue(r.receivable), 0);
    const totalPayables = payables.reduce((sum, p) => sum + getNumericValue(p.payable), 0);

    // Calculate opening balance
    let openingBalance = 0;
    if (startDateParsed) {
      const openingBalanceQuery = { ...query, date: { $lt: startDateParsed } };
      const previousTransactions = await Transaction.find(openingBalanceQuery);
      if (previousTransactions.length > 0) {
        openingBalance = previousTransactions.reduce((sum, t) => {
          const receivable = getNumericValue(t.receivable);
          const payable = getNumericValue(t.payable);
          return sum + (t.transactionType === 'receivable' ? receivable : -payable);
        }, 0);
      } else {
        openingBalance = settingsOpeningBalance;
      }
    } else {
      openingBalance = settingsOpeningBalance;
    }

    const closingBalance = openingBalance + totalReceivables - totalPayables;

    const alerts = [];
    if (transactions.length === 0 && (startDateParsed || endDateParsed)) {
      alerts.push('No transactions recorded for the selected period.');
    }
    if (closingBalance < 0) {
      alerts.push('Warning: Negative cash balance detected.');
    }
    if (Math.abs(totalReceivables) > 10000000 || Math.abs(totalPayables) > 10000000) {
      alerts.push('Notice: Large transaction amounts detected. Please verify data accuracy.');
    }

    const recentTransactions = transactions
      .map(t => {
        const transactionObj = t.toObject();
        const amount = t.transactionType === 'receivable' ? getNumericValue(t.receivable) : getNumericValue(t.payable);
        const totalAmount = getNumericValue(t.totalAmount);
        const remainingAmount = t.transactionType === 'receivable'
          ? Math.max(0, totalAmount - getNumericValue(t.receivable))
          : Math.max(0, totalAmount - getNumericValue(t.payable));
        return {
          ...transactionObj,
          type: t.transactionType,
          amount,
          remainingAmount,
          formattedDate: t.date ? t.date.toISOString().split('T')[0] : 'N/A',
        };
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 10);

    res.json({
      totalReceivables: Math.round(totalReceivables * 100) / 100,
      totalPayables: Math.round(totalPayables * 100) / 100,
      balance: Math.round(closingBalance * 100) / 100,
      openingBalance: Math.round(openingBalance * 100) / 100,
      alerts,
      recentTransactions,
      metadata: {
        dateRange: {
          startDate: startDateParsed ? startDateParsed.toISOString().split('T')[0] : null,
          endDate: endDateParsed ? endDateParsed.toISOString().split('T')[0] : null,
        },
        transactionCount: transactions.length,
        receivableCount: receivables.length,
        payableCount: payables.length,
        shopId: shopId || 'all',
        isAllShops: !query.shopId,
      },
    });
  } catch (error) {
    console.error('Error in getDashboardData:', { 
      message: error.message, 
      stack: error.stack, 
      query: req.query,
      user: req.user?.id,
      role: req.user?.role 
    });
    res.status(500).json({
      error: 'Failed to fetch dashboard data',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};