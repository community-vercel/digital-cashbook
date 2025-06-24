const Payment = require('../models/Payment');
const Customer = require('../models/Customer');
const { put, del } = require('@vercel/blob');

exports.addPayment = async (req, res) => {
  const { customerId, customerName, phone, amount, description, category, type, isRecurring, date,user } = req.body;
  let paymentImage = null;

  try {
    // Handle file upload to Vercel Blob
    if (req.files && req.files.paymentImage) {
      const file = req.files.paymentImage;
      const fileName = `${Date.now()}-${file.name}`;
      const { url } = await put(`payments/${fileName}`, file.data, {
        access: 'public',
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      paymentImage = url;
    }

    let customer;
    if (customerId) {
      customer = await Customer.findById(customerId);
    
    } else if (customerName) {
      customer = await Customer.findOne({ userId: req.user.id, name: customerName });
      if (!customer) {
        customer = new Customer({ userId: req.user.id, name: customerName, phone });
        await customer.save();
      }
    } else {
      return res.status(400).json({ message: 'Customer ID or name required' });
    }

    const payment = new Payment({
      userId: user,
      customerId: customer._id,
      amount,
      description,
      category,
      type,
      isRecurring,
      paymentImage,
      date: date || Date.now(),
    });
    await payment.save();

    customer.balance -= parseFloat(amount);
    await customer.save();

    res.json({ payment, customer });
  } catch (error) {
    console.error('Error in addPayment:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getPayments = async (req, res) => {
  try {
    const { startDate, endDate, category, customerId } = req.query;
    const query = { };
    if (startDate && endDate) {
      query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }
    if (category) query.category = category;
    if (customerId) query.customerId = customerId;
    const payments = await Payment.find(query).sort({ date: -1 }).populate('customerId', 'name');
    res.json(payments);
  } catch (error) {
    console.error('Error in getPayments:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
exports.getuserPayments = async (req, res) => {
  try {
    const { startDate, endDate, category, customerId } = req.query;
    const query = { userId: req.user.id };
    if (startDate && endDate) {
      query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }
    if (category) query.category = category;
    if (customerId) query.customerId = customerId;
    const payments = await Payment.find(query).sort({ date: -1 }).populate('customerId', 'name');
    res.json(payments);
  } catch (error) {
    console.error('Error in getPayments:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.updatePayment = async (req, res) => {
  try {
    let paymentImage = req.body.paymentImage;
    if (req.files && req.files.paymentImage) {
      const file = req.files.paymentImage;
      const fileName = `${Date.now()}-${file.name}`;
      const { url } = await put(`payments/${fileName}`, file.data, {
        access: 'public',
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      paymentImage = url;

      // Delete old image from Vercel Blob if it exists
      const existingPayment = await Payment.findById(req.params.id);
      if (existingPayment.paymentImage) {
        await del(existingPayment.paymentImage, {
          token: process.env.BLOB_READ_WRITE_TOKEN,
        });
      }
    }

    const payment = await Payment.findOneAndUpdate(
      { _id: req.params.id },
      { ...req.body, paymentImage, date: req.body.date || Date.now() },
      { new: true }
    ).populate('customerId', 'name');
    if (!payment) return res.status(404).json({ message: 'Payment not found' });
    res.json(payment);
  } catch (error) {
    console.error('Error in updatePayment:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.deletePayment = async (req, res) => {
  try {
    const payment = await Payment.findOneAndDelete({ _id: req.params.id });
    if (!payment) return res.status(404).json({ message: 'Payment not found' });

    // Delete image from Vercel Blob if it exists
    if (payment.paymentImage) {
      await del(payment.paymentImage, {
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
    }

    res.json({ message: 'Payment deleted' });
  } catch (error) {
    console.error('Error in deletePayment:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getRecurringSuggestions = async (req, res) => {
  try {
    const recurringPayments = await Payment.find({
      userId: req.user.id,
      isRecurring: true,
    }).select('description category type amount');
    res.json(recurringPayments);
  } catch (error) {
    console.error('Error in getRecurringSuggestions:', error);
    res.status(500).json({ message: 'Server error' });
  }
};