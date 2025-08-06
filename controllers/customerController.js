// controllers/customerController.js
const Customer = require('../models/Customer');
const Receipt = require('../models/Receipt');
const Payment = require('../models/Payment');
const mongoose = require('mongoose');

exports.addCustomer = async (req, res) => {
  const { name, phone, address } = req.body;

  try {
    let selectedShopId = req.user.shopId;
    console.log('Request user info:', {
      userId: req.user.id || req.user.userId,
      role: req.user.role,
      shopId: req.user.shopId,
      requestBodyShopId: req.body.shopId
    });
    
    if (req.user.role === 'superadmin' && req.body.shopId) {
      if (!mongoose.Types.ObjectId.isValid(req.body.shopId)) {
        return res.status(400).json({ message: 'Invalid shopId' });
      }
      selectedShopId = req.body.shopId;
    }
    
    if (!selectedShopId) {
      return res.status(400).json({ message: 'Shop ID required' });
    }

    const customer = new Customer({
      userId: req.user.id || req.user.userId,
      name,
      phone,
      address,
      shopId: selectedShopId,
    });
    await customer.save();
    res.json(customer);
  } catch (error) {
    console.error('Error in addCustomer:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getCustomers = async (req, res) => {
  const { search, shopId } = req.query;

  try {
    let selectedShopId = req.user.shopId;

    // Handle superadmin case
    if (req.user.role === 'superadmin' && shopId) {
      if (shopId !== 'all' && !mongoose.Types.ObjectId.isValid(shopId)) {
        return res.status(400).json({ message: 'Invalid shopId' });
      }
      selectedShopId = shopId === 'all' ? null : shopId;
    }

    // Build base query
    const baseQuery = {};
    if (selectedShopId) {
      baseQuery.shopId = selectedShopId;
    }

    // Add search functionality
    if (search) {
      baseQuery.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }

    console.log('Customer query:', baseQuery); // Debug log

    const customers = await Customer.find(baseQuery);
    console.log('Found customers:', customers.length); // Debug log

    res.json(customers);
  } catch (error) {
    console.error('Error in getCustomers:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getCustomerByNameOrPhone = async (req, res) => {
  const { name, phone, shopId } = req.body;

  try {
    let selectedShopId = req.user.shopId;

    // Handle superadmin case
    if (req.user.role === 'superadmin' && shopId) {
      if (shopId !== 'all' && !mongoose.Types.ObjectId.isValid(shopId)) {
        return res.status(400).json({ message: 'Invalid shopId' });
      }
      selectedShopId = shopId === 'all' ? null : shopId;
    }

    // Build search query
    const searchQuery = {};
    if (selectedShopId) {
      searchQuery.shopId = selectedShopId;
    }



    
    if (name || phone) {
      searchQuery.$or = [];
      if (name) searchQuery.$or.push({ name });
      if (phone) searchQuery.$or.push({ phone });
    }

    if (!searchQuery.$or || searchQuery.$or.length === 0) {
      return res.status(400).json({ message: 'Name or phone required' });
    }

    let customer = await Customer.findOne(searchQuery);

    // Create customer if not found and name is provided
    if (!customer && name) {
      if (!selectedShopId) {
        return res.status(400).json({ message: 'Specific shopId required to create a customer' });
      }
      customer = new Customer({
        userId: req.user.id || req.user.userId,
        name,
        phone,
        shopId: selectedShopId,
      });
      await customer.save();
    }

    res.json(customer);
  } catch (error) {
    console.error('Error in getCustomerByNameOrPhone:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.deleteCustomer = async (req, res) => {
  try {
    let selectedShopId = req.user.shopId;
    
    if (!selectedShopId) {
      return res.status(400).json({ message: 'Shop ID required' });
    }

    const customer = await Customer.findOneAndDelete({
      _id: req.params.id,
      shopId: selectedShopId,
    });
    
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    // Optionally delete associated payments and receipts
    await Promise.all([
      Payment.deleteMany({ customerId: req.params.id, shopId: selectedShopId }),
      Receipt.deleteMany({ customerId: req.params.id, shopId: selectedShopId }),
    ]);

    res.json({ message: 'Customer deleted' });
  } catch (error) {
    console.error('Error in deleteCustomer:', error);
    res.status(500).json({ message: `Server error ${error.message}` });
  }
};