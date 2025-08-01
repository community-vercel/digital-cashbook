const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const fileUpload = require('express-fileupload');
const { scheduleDailyReports, getCronStatus } = require('./utils/scheduleDailyReport');
const { scheduleDailyBackup, cleanupOldBackups, createManualBackup } = require('./utils/scheduleBackup');
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

// Load routes one by one with error handling to identify the problematic one
console.log('Loading routes...');

try {
  console.log('Loading auth routes...');
  const authRoutes = require('./routes/auth');
  app.use('/api/auth', authRoutes);
  console.log('✓ Auth routes loaded');
} catch (error) {
  console.error('✗ Error loading auth routes:', error.message);
}

try {
  console.log('Loading dashboard routes...');
  const dashboardRoutes = require('./routes/dashboard');
  app.use('/api/dashboard', dashboardRoutes);
  console.log('✓ Dashboard routes loaded');
} catch (error) {
  console.error('✗ Error loading dashboard routes:', error.message);
}

try {
  console.log('Loading receipt routes...');
  const receiptRoutes = require('./routes/receipts');
  app.use('/api/receipts', receiptRoutes);
  console.log('✓ Receipt routes loaded');
} catch (error) {
  console.error('✗ Error loading receipt routes:', error.message);
}

try {
  console.log('Loading payment routes...');
  const paymentRoutes = require('./routes/payments');
  app.use('/api/payments', paymentRoutes);
  console.log('✓ Payment routes loaded');
} catch (error) {
  console.error('✗ Error loading payment routes:', error.message);
}

try {
  console.log('Loading report routes...');
  const reportRoutes = require('./routes/reports');
  app.use('/api/reports', reportRoutes);
  console.log('✓ Report routes loaded');
} catch (error) {
  console.error('✗ Error loading report routes:', error.message);
}

try {
  console.log('Loading customer routes...');
  const customerRoutes = require('./routes/customers');
  app.use('/api/customers', customerRoutes);
  console.log('✓ Customer routes loaded');
} catch (error) {
  console.error('✗ Error loading customer routes:', error.message);
}

try {
  console.log('Loading category routes...');
  const categoryRoutes = require('./routes/category');
  app.use('/api/categories', categoryRoutes);
  console.log('✓ Category routes loaded');
} catch (error) {
  console.error('✗ Error loading category routes:', error.message);
}

try {
  console.log('Loading setting routes...');
  const settingRoutes = require('./routes/setting');
  app.use('/api/settings', settingRoutes);
  console.log('✓ Setting routes loaded');
} catch (error) {
  console.error('✗ Error loading setting routes:', error.message);
}

try {
  console.log('Loading transaction routes...');
  const transactionRoutes = require('./routes/transactionRoutes');
  app.use('/api/transactions', transactionRoutes);
  console.log('✓ Transaction routes loaded');
} catch (error) {
  console.error('✗ Error loading transaction routes:', error.message);
}

try {
  console.log('Loading user routes...');
  app.use('/api/users', require('./routes/users'));
  console.log('✓ User routes loaded');
} catch (error) {
  console.error('✗ Error loading user routes:', error.message);
}

try {
  console.log('Loading product routes (items)...');
  const productRoutes = require('./routes/products');
  app.use('/api/items', productRoutes);
  console.log('✓ Product routes (items) loaded');
} catch (error) {
  console.error('✗ Error loading product routes (items):', error.message);
}

try {
  console.log('Loading product routes (product)...');
  const productsRoutes = require('./routes/product');
  app.use('/api/product', productsRoutes);
  console.log('✓ Product routes (product) loaded');
} catch (error) {
  console.error('✗ Error loading product routes (product):', error.message);
}

try {
  console.log('Loading color routes...');
  const colorRoutes = require('./routes/colors');
  app.use('/api/colors', colorRoutes);
  console.log('✓ Color routes loaded');
} catch (error) {
  console.error('✗ Error loading color routes:', error.message);
}

try {
  console.log('Loading backup routes...');
  const backupRoutes = require('./routes/backup');
  app.use('/api/backup', backupRoutes);
  console.log('✓ Backup routes loaded');
} catch (error) {
  console.error('✗ Error loading backup routes:', error.message);
}

try {
  console.log('Loading cron routes...');
  const cronRoutes = require('./routes/cron');
  app.use('/api/cron', cronRoutes);
  console.log('✓ Cron routes loaded');
} catch (error) {
  console.error('✗ Error loading cron routes:', error.message);
}

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
try {
  console.log('Loading error handler...');
  const errorHandler = require('./middleware/errorHandler');
  app.use(errorHandler);
  console.log('✓ Error handler loaded');
} catch (error) {
  console.error('✗ Error loading error handler:', error.message);
}

// Handle 404 for unmatched routes
app.use((req, res) => {
  res.status(404).json({
    message: 'Route not found',
    timestamp: new Date().toISOString()
  });
});

console.log('All routes loaded successfully!');

const PORT = process.env.PORT || 5000;

if (!isServerless) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Cron jobs initialized for traditional server environment');
  });
}

// Export for Vercel
module.exports = app;