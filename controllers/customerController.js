const Customer = require('../models/Customer');
const Receipt = require('../models/Receipt');
const Payment = require('../models/Payment');
exports.addCustomer = async (req, res) => {
  const { name, phone, address } = req.body;
  try {
    const customer = new Customer({  name, phone, address });
    await customer.save();
    res.json(customer);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getCustomers = async (req, res) => {
  const { search } = req.query;
  try {
    const query = { userId: req.user.id };
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }
    const customers = await Customer.find(query);
    res.json(customers);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getCustomerByNameOrPhone = async (req, res) => {
  const { name, phone } = req.body;
  try {
    let customer = await Customer.findOne({
      userId: req.user.id,
      $or: [{ name }, { phone }],
    });
    if (!customer && name) {
      customer = new Customer({ userId: req.user.id, name, phone });
      await customer.save();
    }
    res.json(customer);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

exports.deleteCustomer = async (req, res) => {
  try {
    const customer = await Customer.findOneAndDelete({
      _id: req.params.id,
    
    });
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    // Optionally, delete associated payments and receipts
    // await Promise.all([
    //   Payment.deleteMany({ customerId: req.params.id }),
    //   Receipt.deleteMany({ customerId: req.params.id }),
    // ]);

    res.json({ message: 'Customer deleted' });
  } catch (error) {
    console.error('Error in deleteCustomer:', error);
    res.status(500).json({ message: `Server error ${error.message}` });
  }
};