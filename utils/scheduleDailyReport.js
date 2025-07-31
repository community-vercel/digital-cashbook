// utils/scheduleDailyReport.js
const cron = require('node-cron');
const { generateDailyReport } = require('./generateDailyReport');
const { sendDailyReportEmail } = require('./sendEmail');

function scheduleDailyReports() {
  // Add more detailed logging and error handling
  cron.schedule('15 22 * * *', async () => {
    const startTime = new Date();
    console.log(`[${startTime.toISOString()}] Starting daily report generation...`);
    
    try {
      const today = new Date();
      console.log(`[${new Date().toISOString()}] Generating report for date: ${today.toISOString().split('T')[0]}`);
      
      // Generate the report
      const blobUrl = await generateDailyReport(today);
      console.log(`[${new Date().toISOString()}] Report generated successfully. URL: ${blobUrl}`);
      
      // Send the email
      console.log(`[${new Date().toISOString()}] Attempting to send email...`);
      await sendDailyReportEmail(blobUrl, today);
      
      const endTime = new Date();
      const duration = endTime - startTime;
      console.log(`[${endTime.toISOString()}] Daily report sent successfully to admin. Duration: ${duration}ms`);
      
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error in daily report process:`, {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      
      // Optional: Send error notification email
      try {
        // You could implement an error notification system here
        console.log(`[${new Date().toISOString()}] Attempting to send error notification...`);
      } catch (notificationError) {
        console.error(`[${new Date().toISOString()}] Failed to send error notification:`, notificationError.message);
      }
    }
  }, {
    timezone: 'Asia/Karachi',
    scheduled: true
  });
  
  // Add a test function that can be called manually
  const testDailyReport = async () => {
    console.log(`[${new Date().toISOString()}] Manual test of daily report started...`);
    try {
      const today = new Date();
      const blobUrl = await generateDailyReport(today);
      await sendDailyReportEmail(blobUrl, today);
      console.log(`[${new Date().toISOString()}] Manual test completed successfully`);
      return { success: true, message: 'Report sent successfully' };
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Manual test failed:`, error);
      return { success: false, error: error.message };
    }
  };
  
  // Log scheduler initialization
  console.log(`[${new Date().toISOString()}] Daily report scheduler initialized. Next run: 22:05 PKT`);
  
  return { testDailyReport };
}

// Additional debugging function to check cron job status
function getCronStatus() {
  const now = new Date();
  const pakistanTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Karachi"}));
  
  return {
    currentTime: now.toISOString(),
    pakistanTime: pakistanTime.toISOString(),
    nextScheduledRun: '22:15 PKT daily',
    timezone: 'Asia/Karachi'
  };
}

module.exports = { 
  scheduleDailyReports,
  getCronStatus
};