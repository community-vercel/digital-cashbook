const Receipt = require('../models/Receipt');
const Payment = require('../models/Payment');

exports.getDashboardData = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const query = {  }; // Changed from user to userId for consistency

    // Apply date filters if provided
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      if (isNaN(start) || isNaN(end)) {
        return res.status(400).json({ error: 'Invalid date format' });
      }
      query.date = { $gte: start, $lte: end };
    }

    // Fetch receipts and payments with customer data
    const [receipts, payments] = await Promise.all([
      Receipt.find(query).populate('customerId', 'name'),
      Payment.find(query).populate('customerId', 'name'),
    ]);

    // Calculate totals
    const totalReceipts = receipts.reduce((sum, r) => sum + (r.amount || 0), 0);
    const totalPayments = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

    // Calculate opening balance (sum of all transactions before startDate)
    let openingBalanceQuery = {  };
    if (startDate) {
      openingBalanceQuery.date = { $lt: new Date(startDate) };
    }
    const [previousReceipts, previousPayments] = await Promise.all([
      Receipt.find(openingBalanceQuery),
      Payment.find(openingBalanceQuery),
    ]);
    const openingBalance =
      previousReceipts.reduce((sum, r) => sum + (r.amount || 0), 0) -
      previousPayments.reduce((sum, p) => sum + (p.amount || 0), 0);

    // Calculate closing balance
    const closingBalance = totalReceipts - totalPayments + openingBalance;

    // Check for discrepancies
    const alerts = [];
    if (receipts.length === 0 && payments.length === 0 && startDate && endDate) {
      alerts.push('No transactions recorded for the selected period.');
    }
    if (closingBalance < 0) {
      alerts.push('Warning: Negative cash balance detected.');
    }

    // Combine and sort recent transactions
    const recentTransactions = [
      ...receipts.map(t => ({ ...t.toObject(), type: 'receipt' })),
      ...payments.map(t => ({ ...t.toObject(), type: 'payment' })),
    ]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 10);

    res.json({
      totalReceipts,
      totalPayments,
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