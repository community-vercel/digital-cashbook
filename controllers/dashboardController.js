const Receipt = require('../models/Receipt');
const Payment = require('../models/Payment');

exports.getDashboardData = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const userId = req.user.userId; // Ensure userId is available
    const query = { user: userId };

    // Log userId for debugging
    console.log('User ID:', userId);

    // Add date filter if provided
    if (startDate && endDate) {
      query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
      console.log('Date filter applied:', query.date);
    }

    // Fetch receipts and payments
    const receipts = await Receipt.find(query);
    const payments = await Payment.find(query);

    // Log fetched data for debugging
    console.log('Receipts found:', receipts.length);
    console.log('Payments found:', payments.length);

    // Calculate totals
    const totalReceipts = receipts.reduce((sum, r) => sum + r.amount, 0);
    const totalPayments = payments.reduce((sum, p) => sum + p.amount, 0);

    // Calculate opening balance
    const firstReceipt = await Receipt.findOne({ user: userId }).sort({ createdAt: 1 });
    const openingBalance = firstReceipt ? firstReceipt.amount : 0;

    // Calculate closing balance
    const closingBalance = totalReceipts - totalPayments;

    // Generate alerts
    const alerts = [];
    if (receipts.length === 0 && payments.length === 0) {
      alerts.push('No transactions recorded for the selected period.');
    } else if (closingBalance < 0) {
      alerts.push('Warning: Negative cash balance detected.');
    }

    // Combine and sort recent transactions
    const recentTransactions = [...receipts, ...payments]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 10);

    // Respond with data
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
    res.status(500).json({ error: error.message });
  }
};