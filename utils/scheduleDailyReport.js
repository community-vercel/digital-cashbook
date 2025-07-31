// utils/scheduleDailyReport.js
const cron = require('node-cron');
const { generateDailyReport } = require('./generateDailyReport');
const { sendDailyReportEmail } = require('./sendEmail');

function scheduleDailyReports() {
  cron.schedule('0 22 * * *', async () => {
    try {
      const today = new Date();
      const blobUrl = await generateDailyReport(today);
      await sendDailyReportEmail(blobUrl, today);
      console.log(`Daily report sent to admin`);
    } catch (error) {
      console.error('Error scheduling daily reports:', error);
    }
  }, {
    timezone: 'Asia/Karachi',
  });
}

module.exports = { scheduleDailyReports };