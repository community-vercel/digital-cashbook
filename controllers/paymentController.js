const Payment = require('../models/Payment');

exports.createPayment = async (req, res) => {
  try {
    const payment = new Payment({
      ...req.body,
      user: req.user.userId,
    });
    await payment.save();
    
    // Auto-suggestions for recurring expenses
    if (req.body.isRecurring) {
      // Logic to store recurring expense template (can be expanded)
      console.log('Recurring expense template saved:', req.body.description);
    }
    
    res.status(201).json(payment);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getPayments = async (req, res) => {
  try {
    const { startDate, endDate, category } = req.query;
    const query = { user: req.user.userId };
    
    if (startDate && endDate) {
      query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }
    if (category) query.category = category;
    
    const payments = await Payment.find(query).sort({ date: -1 });
    res.json(payments);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.updatePayment = async (req, res) => {
  try {
    const payment = await Payment.findOneAndUpdate(
      { _id: req.params.id, user: req.user.userId },
      req.body,
      { new: true }
    );
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    res.json(payment);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.deletePayment = async (req, res) => {
  try {
    const payment = await Payment.findOneAndDelete({
      _id: req.params.id,
      user: req.user.userId,
    });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    res.json({ message: 'Payment deleted' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getRecurringSuggestions = async (req, res) => {
  try {
    const recurringPayments = await Payment.find({
      user: req.user.userId,
      isRecurring: true,
    }).select('description category amount');
    res.json(recurringPayments);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};