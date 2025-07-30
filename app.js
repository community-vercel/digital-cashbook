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
const transactionROutes = require('./routes/transactionRoutes');
const productRoutes = require('./routes/products');
const errorHandler = require('./middleware/errorHandler');
const itemRoutes = require('./routes/products');
const productsRoutes = require('./routes/product');
const colorRoutes=require('./routes/colors');
const fileUpload = require('express-fileupload');
const { scheduleDailyReports } = require('./utils/scheduleDailyReport');
const backupRoutes = require('./routes/backup');
const { scheduleDailyBackup } = require('./utils/scheduleBackup');

require('dotenv').config();

const app = express();
// app.use(
//   cors({
//     origin: process.env.FRONTEND_URL || 'http://localhost:3000' || 'https://client-phi-orcin.vercel.app',
//     methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
//     allowedHeaders: ['Content-Type', 'Authorization'],
//     credentials: true,
//   })
// );
// Middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload({
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  abortOnLimit: true
}));

// Connect to MongoDB
connectDB();

scheduleDailyReports();
scheduleDailyBackup();


app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});


app.use(express.json());
app.use('/uploads', express.static('uploads')); // Serve uploaded files

// Routes

app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/receipts', receiptRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/customers',customerRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/settings', settingRoutes);
app.use('/api/transactions',transactionROutes);
app.use('/api/users', require('./routes/users'));
app.use('/api/items', productRoutes);
app.use('/api/product', productsRoutes);
app.use('/api/colors', colorRoutes);
app.use('/api/backup', backupRoutes);



const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));