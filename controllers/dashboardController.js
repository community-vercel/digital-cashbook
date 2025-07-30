// backend/controllers/dashboardController.js
const Transaction = require('../models/Transaction');
const Setting = require('../models/Setting');

// Helper function to safely parse dates as UTC
const parseUTCDate = (dateString, isEndOfDay = false) => {
  if (!dateString || typeof dateString !== 'string') {
    return null;
  }
  
  // Remove any existing time or timezone info and ensure YYYY-MM-DD format
  const cleanDateString = dateString.split('T')[0].trim();
  
  // Validate date format (YYYY-MM-DD)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDateString)) {
    throw new Error(`Invalid date format: ${dateString}. Expected YYYY-MM-DD`);
  }
  
  const timeString = isEndOfDay ? '23:59:59.999Z' : '00:00:00.000Z';
  const utcDateString = `${cleanDateString}T${timeString}`;
  const date = new Date(utcDateString);
  
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${dateString}`);
  }
  
  return date;
};

// Helper function to safely get numeric value
const getNumericValue = (value, defaultValue = 0) => {
  const num = Number(value);
  return (typeof num === 'number' && !isNaN(num)) ? num : defaultValue;
};

exports.getDashboardData = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const query = {};

    // Fetch settings for opening balance
    const settings = await Setting.findOne();
    
    if (!settings) {
      console.error('Settings not found in database');
      return res.status(404).json({ 
        error: 'Settings not found. Please configure settings in the admin panel.' 
      });
    }

    // Log openingBalance from settings
    const settingsOpeningBalance = getNumericValue(settings.openingBalance);

    // Apply date filters if provided with enhanced validation
    let startDateParsed = null;
    let endDateParsed = null;
    
    if (startDate || endDate) {
      try {
        if (startDate) {
          startDateParsed = parseUTCDate(startDate, false);
        }
        
        if (endDate) {
          endDateParsed = parseUTCDate(endDate, true);
        }
        
        // Validate date range
        if (startDateParsed && endDateParsed && startDateParsed > endDateParsed) {
          return res.status(400).json({ 
            error: 'Start date cannot be after end date' 
          });
        }
        
        // Build date query
        if (startDateParsed && endDateParsed) {
          query.date = { $gte: startDateParsed, $lte: endDateParsed };
        } else if (startDateParsed) {
          query.date = { $gte: startDateParsed };
        } else if (endDateParsed) {
          query.date = { $lte: endDateParsed };
        }
        
        
      } catch (dateError) {
        return res.status(400).json({ 
          error: dateError.message 
        });
      }
    } else {
    }

    // Fetch transactions with customer data
    const transactions = await Transaction.find(query).populate('customerId', 'name');
   

    // Separate transactions by type and calculate totals with enhanced validation
    const receivables = transactions.filter(t => t.transactionType === 'receivable');
    const payables = transactions.filter(t => t.transactionType === 'payable');
    
    const totalReceivables = receivables.reduce((sum, r) => {
      const amount = getNumericValue(r.receivable);
      return sum + amount;
    }, 0);
    
    const totalPayables = payables.reduce((sum, p) => {
      const amount = getNumericValue(p.payable);
      return sum + amount;
    }, 0);
    

    // Calculate opening balance with improved logic
    let openingBalance = 0;
    
    if (startDateParsed) {
      // Get transactions before the start date for opening balance
      const openingBalanceQuery = { date: { $lt: startDateParsed } };
      
      const previousTransactions = await Transaction.find(openingBalanceQuery);
    
      if (previousTransactions.length > 0) {
        openingBalance = previousTransactions.reduce((sum, t) => {
          const receivable = getNumericValue(t.receivable);
          const payable = getNumericValue(t.payable);
          const amount = t.transactionType === 'receivable' ? receivable : -payable;
          return sum + amount;
        }, 0);
      } else {
        // No previous transactions, use settings opening balance
        openingBalance = settingsOpeningBalance;
      }
    } else {
      // No start date provided, use settings opening balance
      openingBalance = settingsOpeningBalance;
    }
    

    // Calculate closing balance
    const closingBalance = openingBalance + totalReceivables - totalPayables;
    console.log('Closing balance calculation:', {
      openingBalance,
      totalReceivables,
      totalPayables,
      closingBalance
    });

    // Generate alerts with enhanced checks
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

    // Process recent transactions with better data handling
    const recentTransactions = transactions
      .map(t => {
        const transactionObj = t.toObject();
        const amount = t.transactionType === 'receivable' 
          ? getNumericValue(t.receivable) 
          : getNumericValue(t.payable);
        
        const totalAmount = getNumericValue(t.totalAmount);
        const remainingAmount = t.transactionType === 'receivable' 
          ? Math.max(0, totalAmount - getNumericValue(t.receivable))
          : Math.max(0, totalAmount - getNumericValue(t.payable));

        return {
          ...transactionObj,
          type: t.transactionType,
          amount,
          remainingAmount,
          formattedDate: t.date ? t.date.toISOString().split('T')[0] : 'N/A'
        };
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 10);

  

    // Prepare response with additional metadata
    const response = {
      totalReceivables: Math.round(totalReceivables * 100) / 100, // Round to 2 decimal places
      totalPayables: Math.round(totalPayables * 100) / 100,
      balance: Math.round(closingBalance * 100) / 100,
      openingBalance: Math.round(openingBalance * 100) / 100,
      alerts,
      recentTransactions,
      metadata: {
        dateRange: {
          startDate: startDateParsed ? startDateParsed.toISOString().split('T')[0] : null,
          endDate: endDateParsed ? endDateParsed.toISOString().split('T')[0] : null
        },
        transactionCount: transactions.length,
        receivableCount: receivables.length,
        payableCount: payables.length
      }
    };

    res.json(response);

  } catch (error) {
    console.error('Error in getDashboardData:', {
      message: error.message,
      stack: error.stack,
      query: req.query
    });
    
    res.status(500).json({ 
      error: 'Failed to fetch dashboard data',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};