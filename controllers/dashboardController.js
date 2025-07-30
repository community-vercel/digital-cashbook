// controllers/dashboardController.js
const Transaction = require('../models/Transaction');
const Setting = require('../models/Setting');

exports.getDashboardData = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const query = {};

    // Apply date filters if provided
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ error: 'Invalid date format' });
      }
      query.date = { $gte: start, $lte: end };
    }

    // Fetch transactions with customer data
    const transactions = await Transaction.find(query).populate('customerId', 'name');

    // Separate transactions by type and calculate totals
    const receivables = transactions.filter(t => t.transactionType === 'receivable');
    const payables = transactions.filter(t => t.transactionType === 'payable');
    const totalReceivables = receivables.reduce((sum, r) => sum + (r.receivable || 0), 0);
    const totalPayables = payables.reduce((sum, p) => sum + (p.payable || 0), 0);

    // Calculate opening balance (sum of all transactions before startDate)
        let openingBalance = 0;

    let openingBalanceQuery = {};
    if (startDate) {
      openingBalanceQuery.date = { $lt: new Date(startDate) };
    }
    const previousTransactions = await Transaction.find(openingBalanceQuery);
      if (previousTransactions.length > 0) {
      // Use transactions if available
      openingBalance = previousTransactions.reduce(
        (sum, t) => sum + (t.transactionType === 'receivable' ? (t.receivable || 0) : -(t.payable || 0)),
        0
      );
    } else {
      // Use stored opening balance if no prior transactions
      const settings = await Setting.findOne();
      if (settings && settings.openingBalance !== null) {
        openingBalance = settings.openingBalance;
      }
    }
  

    // Calculate closing balance
    const closingBalance = totalReceivables - totalPayables + openingBalance;

    // Check for discrepancies
    const alerts = [];
    if (transactions.length === 0 && startDate && endDate) {
      alerts.push('No transactions recorded for the selected period.');
    }
    if (closingBalance < 0) {
      alerts.push('Warning: Negative cash balance detected.');
    }

    // Sort and limit recent transactions
    const recentTransactions = transactions
      .map(t => ({
        ...t.toObject(),
        type: t.transactionType, // For compatibility with frontend
        amount: t.transactionType === 'receivable' ? t.receivable : t.payable, // For compatibility
      }))
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 10);

    res.json({
      totalReceivables,
      totalPayables,
      balance: closingBalance,
      openingBalance,
      alerts,
      recentTransactions,
    });
  } catch (error) {
    console.error('Error in getDashboardData:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
};