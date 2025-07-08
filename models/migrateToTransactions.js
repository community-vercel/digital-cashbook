// scripts/migrateToTransactions.js
const mongoose = require('mongoose');
const Payment = require('./Payment');
const Receipt = require('./Receipt');
const Transaction = require('./Transaction');

async function migrate() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
         useNewUrlParser: true,
         useUnifiedTopology: true,
       });
    // Migrate Payments
    const payments = await Payment.find();
    for (const payment of payments) {
      const transaction = new Transaction({
        ...payment._doc,
        transactionImage: payment.paymentImage,
        transactionType: 'payment',
      });
      await transaction.save();
    }

    // Migrate Receipts
    const receipts = await Receipt.find();
    for (const receipt of receipts) {
      const transaction = new Transaction({
        ...receipt._doc,
        transactionImage: receipt.receiptImage,
        transactionType: 'receipt',
        isRecurring: false, // Receipts didn't have isRecurring; set to false
      });
      await transaction.save();
    }

    console.log('Migration completed');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrate();