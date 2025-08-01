// utils/scheduleDailyReport.js
const cron = require('node-cron');
const { generateDailyReport } = require('./generateDailyReport');
const { sendDailyReportEmail } = require('./sendEmail');

function scheduleDailyReports() {
  // Check if we're in a serverless environment
  const isServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;
  
  if (isServerless) {
    console.log(`[${new Date().toISOString()}] Running in serverless environment - cron jobs not supported`);
    console.log('Please use Vercel Cron Jobs or external cron services for scheduled tasks');
    return { testDailyReport: getTestFunction() };
  }

  // Only schedule cron job in traditional server environments
  console.log(`[${new Date().toISOString()}] Scheduling daily report cron job...`);
  
const cronJob = cron.schedule('09 0 * * *', async () => {
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
      console.log(`[${endTime.toISOString()}] Daily report sent successfully. Duration: ${duration}ms`);
      
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error in daily report process:`, {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      
      // Optional: Send error notification email
      try {
        console.log(`[${new Date().toISOString()}] Attempting to send error notification...`);
        // Implement error notification system here
      } catch (notificationError) {
        console.error(`[${new Date().toISOString()}] Failed to send error notification:`, notificationError.message);
      }
    }
  }, {
    timezone: 'Asia/Karachi',
    scheduled: true
  });
  
  console.log(`[${new Date().toISOString()}] Daily report scheduler initialized. Next run: 22:15 PKT`);
  
  return { 
    testDailyReport: getTestFunction(),
    cronJob // Return the cron job instance for management
  };
}

// Extract test function for reuse
function getTestFunction() {
  return async () => {
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
}

// API endpoint for manual report generation (for Vercel)
async function generateManualReport(req, res) {
  try {
    const testFunction = getTestFunction();
    const result = await testFunction();
    
    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
}

function getCronStatus() {
  const now = new Date();
  const pakistanTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Karachi"}));
  const isServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;
  
  return {
    currentTime: now.toISOString(),
    pakistanTime: pakistanTime.toISOString(),
    nextScheduledRun: isServerless ? 'Not scheduled (serverless environment)' : '22:15 PKT daily',
    timezone: 'Asia/Karachi',
    environment: isServerless ? 'serverless' : 'traditional server',
    recommendation: isServerless ? 'Use Vercel Cron Jobs or external cron service' : 'Node-cron active'
  };
}

module.exports = { 
  scheduleDailyReports,
  getCronStatus,
  generateManualReport
};