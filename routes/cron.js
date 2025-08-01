// routes/cron.js
const express = require('express');
const router = express.Router();
const { generateDailyReport } = require('../utils/generateDailyReport');
const { sendDailyReportEmail } = require('../utils/sendEmail');
const { createManualBackup } = require('../utils/scheduleBackup');

// Middleware to verify cron requests (optional security)
function verifyCronRequest(req, res, next) {
  // Vercel adds specific headers to cron requests
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  
  // If you have a CRON_SECRET environment variable, verify it
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  next();
}

// Daily report cron endpoint - CHANGED TO GET
router.get('/daily-report', verifyCronRequest, async (req, res) => {
  const startTime = new Date();
  
  try {
    console.log(`[${startTime.toISOString()}] Vercel cron: Starting daily report generation...`);
    
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
    
    res.status(200).json({
      success: true,
      message: 'Daily report generated and sent successfully',
      duration: `${duration}ms`,
      timestamp: endTime.toISOString()
    });
    
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Vercel cron error:`, {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Daily backup cron endpoint - CHANGED TO GET
router.get('/daily-backup', verifyCronRequest, async (req, res) => {
  const startTime = new Date();
  
  try {
    console.log(`[${startTime.toISOString()}] Vercel cron: Starting daily backup...`);
    
    const result = await createManualBackup();
    
    const endTime = new Date();
    const duration = endTime - startTime;
    console.log(`[${endTime.toISOString()}] Daily backup completed. Duration: ${duration}ms`);
    
    res.status(200).json({
      success: true,
      message: 'Daily backup completed successfully',
      result,
      duration: `${duration}ms`,
      timestamp: endTime.toISOString()
    });
    
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Vercel backup cron error:`, {
      message: error.message,
      stack: error.stack
    });
    
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Keep POST routes for manual testing
router.post('/test-report', async (req, res) => {
  try {
    const today = new Date();
    const blobUrl = await generateDailyReport(today);
    await sendDailyReportEmail(blobUrl, today);
    
    res.status(200).json({
      success: true,
      message: 'Test report sent successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

router.post('/test-backup', async (req, res) => {
  try {
    const result = await createManualBackup();
    
    res.status(200).json({
      success: true,
      message: 'Test backup completed successfully',
      result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;