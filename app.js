const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const receiptRoutes = require('./routes/receipts');
const paymentRoutes = require('./routes/payments');
const reportRoutes = require('./routes/reports');
const customerRoutes = require('./routes/customers');
const categoryRoutes = require('./routes/category');
const settingRoutes = require('./routes/setting');
const transactionRoutes = require('./routes/transactionRoutes');
const productRoutes = require('./routes/products');
const errorHandler = require('./middleware/errorHandler');
const productsRoutes = require('./routes/product');
const colorRoutes = require('./routes/colors');
const fileUpload = require('express-fileupload');
const { scheduleDailyReports, getCronStatus } = require('./utils/scheduleDailyReport');
const backupRoutes = require('./routes/backup');
const { scheduleDailyBackup, cleanupOldBackups, createManualBackup } = require('./utils/scheduleBackup');
const cronRoutes = require('./routes/cron');
require('dotenv').config();

const app = express();

// Middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload({
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  abortOnLimit: true
}));

// CORS setup
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

app.use('/uploads', express.static('uploads')); // Serve uploaded files

// Connect to MongoDB
connectDB();

// Initialize schedulers only in non-serverless environments
const isServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;

if (!isServerless) {
  console.log('Initializing traditional server cron jobs...');
  scheduleDailyReports();
  scheduleDailyBackup();
} else {
  console.log('Running in serverless environment - using Vercel Cron Jobs');
}

// Log cron status
console.log('Cron Status:', getCronStatus());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/receipts', receiptRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/settings', settingRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/users', require('./routes/users'));
app.use('/api/items', productRoutes);
app.use('/api/product', productsRoutes);
app.use('/api/colors', colorRoutes);
app.use('/api/backup', backupRoutes);
app.use('/api/cron', cronRoutes); // Add cron routes for Vercel

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: isServerless ? 'serverless' : 'traditional',
    cronStatus: getCronStatus()
  });
});

// Error handling middleware
app.use(errorHandler);

// Handle 404 for unmatched routes
app.use((req, res) => {
  res.status(404).json({
    message: 'Route not found',
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 5000;

if (!isServerless) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Cron jobs initialized for traditional server environment');
  });
}

// Export for Vercel
module.exports = app;