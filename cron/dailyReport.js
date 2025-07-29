// cron/dailyReport.js
const cron = require('node-cron');
const Transaction = require('../models/Transaction');
const { generatePDFReport } = require('../utils/generateDailyReport');
const { sendEmail } = require('../utils/sendEmail');
const path = require('path');
const { put } = require('@vercel/blob');

const scheduleDailyReport = () => {
  // Schedule to run every day at 12 AM
  cron.schedule('0 0 * * *', async () => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);

      // Fetch transactions for the day
      const transactions = await Transaction.find({
        date: { $gte: today, $lt: tomorrow },
      }).populate('customerId', 'name');

      if (transactions.length === 0) {
        console.log('No transactions for today.');
        return;
      }

      // Generate PDF
      const outputPath = path.join(__dirname, '../reports');
      const pdfPath = await generatePDFReport(transactions, today, outputPath);

      // Upload PDF to Vercel Blob
      const { url } = await put(
        `reports/Daily_Transaction_Report_${today.toISOString().split('T')[0]}.pdf`,
        fs.createReadStream(pdfPath),
        {
          access: 'public',
          token: process.env.BLOB_READ_WRITE_TOKEN,
        }
      );

      // Fetch all users (assuming you have a User model)
      const User = require('../models/User'); // Adjust path as needed
      const users = await User.find({}); // Modify to filter specific users if needed

      // Send email to each user
      for (const user of users) {
        await sendEmail(
          user.email,
          `Daily Transaction Report - ${today.toISOString().split('T')[0]}`,
          'Please find attached the daily transaction report.',
          pdfPath
        );
      }

      // Save report metadata (optional, for frontend display)
      const Report = require('../models/Report'); // Create a Report model if needed
      await Report.create({
        date: today,
        fileUrl: url,
        createdAt: new Date(),
      });

      console.log('Daily report generated and emailed successfully.');
    } catch (error) {
      console.error('Error in daily report cron job:', error);
    }
  });
};

module.exports = { scheduleDailyReport };