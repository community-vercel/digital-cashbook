// scripts/migrateDhaShop.js
const mongoose = require('mongoose');
const Shop = require('./models/Shop');
const Transaction = require('./models/Transaction');
const Customer = require('./models/Customer');
const Setting = require('./models/Setting');
const connectDB = require('./config/db'); // Adjust to your DB connection logic

async function migrateDhaShop() {
  try {
    await connectDB();

    let dhaShop = await Shop.findOne({ name: 'DHA Shop' });
    if (!dhaShop) {
      dhaShop = new Shop({ name: 'DHA Shop', location: 'DHA, Islamabad' });
      await dhaShop.save();
      console.log('DHA Shop created:', dhaShop);
    }

    await Transaction.updateMany(
      { shopId: { $exists: false } },
      { $set: { shopId: dhaShop._id } }
    );
    console.log('Transactions updated with DHA shopId');

    await Customer.updateMany(
      { shopId: { $exists: false } },
      { $set: { shopId: dhaShop._id } }
    );
    console.log('Customers updated with DHA shopId');

    await Setting.updateMany(
      { shopId: { $exists: false } },
      { $set: { shopId: dhaShop._id } }
    );
    console.log('Settings updated with DHA shopId');

    console.log('Migration completed');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrateDhaShop();