const Receipt = require('../models/Receipt');
const Payment = require('../models/Payment');

exports.getDashboardData = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const query = { user: req.user.userId };
    
    if (startDate && endDate) {
      query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }

    const receipts = await Receipt.find(query);
    const payments = await Payment.find(query);
    
    const totalReceipts = receipts.reduce((sum, r) => sum + r.amount, 0);
    const totalPayments = payments.reduce((sum, p) => sum + p.amount, 0);
    
    // Calculate opening and closing balances
    const openingBalance = await Receipt.findOne({ user: req.user.userId })
      .sort({ createdAt: 1 })
      .then(r => r ? r.amount : 0);
    const closingBalance = totalReceipts - totalPayments;

    // Check for discrepancies
    const alerts = [];
    if (receipts.length === 0 && payments.length === 0) {
      alerts.push('No transactions recorded for the selected period.');
    } else if (closingBalance < 0) {
      alerts.push('Warning: Negative cash balance detected.');
    }

    res.json({
      totalReceipts,
      totalPayments,
      balance: closingBalance,
      openingBalance,
      alerts,
      recentTransactions: [...receipts, ...payments]
        .sort((a, b) => b.date - a.date)
        .slice(0, 10),
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};