// utils/generateDailyReport.js
const PDFDocument = require('pdfkit');
const { put } = require('@vercel/blob');
const Transaction = require('../models/Transaction');
const Customer = require('../models/Customer');
const Setting = require('../models/Setting');
const axios = require('axios');

const formatCurrency = (value) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'PKR',
  }).format(value);
};

async function generateDailyReport(date) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  // Fetch all transactions for the date
  const transactions = await Transaction.find({
    date: { $gte: startOfDay, $lte: endOfDay },
  }).populate('customerId', 'name');

  // Fetch transactions before the date for opening balance
  const previousTransactions = await Transaction.find({
    date: { $lt: startOfDay },
  });

  // Calculate opening balance
  const openingReceivables = previousTransactions
    .filter((t) => t.transactionType === 'receivable')
    .reduce((sum, t) => sum + t.receivable, 0);
  const openingPayables = previousTransactions
    .filter((t) => t.transactionType === 'payable')
    .reduce((sum, t) => sum + t.payable, 0);
  const openingBalance = openingReceivables - openingPayables;

  // Calculate daily totals
  const totalPayables = transactions
    .filter((t) => t.transactionType === 'payable')
    .reduce((sum, t) => sum + t.payable, 0);
  const totalReceivables = transactions
    .filter((t) => t.transactionType === 'receivable')
    .reduce((sum, t) => sum + t.receivable, 0);
  const dailyBalance = totalReceivables - totalPayables;

  // Calculate closing balance
  const closingBalance = openingBalance + dailyBalance;

  // Log transactions for debugging
  console.log('Transactions:', transactions.map(t => ({
    customer: t.customerId?.name || 'Unknown Customer',
    type: t.transactionType,
    amount: t.transactionType === 'payable' ? t.payable : t.receivable,
    description: t.description,
  })));
  console.log('Summary:', {
    openingBalance,
    totalReceivables,
    totalPayables,
    dailyBalance,
    closingBalance,
  });

  // Fetch settings for store name and logo
  const settings = await Setting.findOne();
  if (!settings) {
    throw new Error('Settings not found');
  }
  const storeName = settings.siteName || 'Your Store Name';
  let logoBuffer;
  try {
    const response = await axios.get(settings.logo, { responseType: 'arraybuffer' });
    logoBuffer = Buffer.from(response.data);
  } catch (error) {
    console.error('Error fetching logo:', error.message);
    logoBuffer = null;
  }

  const doc = new PDFDocument({ margin: 40 });
  const fileName = `daily_report_${date.toISOString().split('T')[0]}.pdf`;

  const buffers = [];
  doc.on('data', buffers.push.bind(buffers));
  doc.on('end', () => {});

  // Header Section
  doc.fillColor('#1e3a8a').font('Helvetica-Bold');
  if (logoBuffer) {
    try {
      doc.image(logoBuffer, 40, 20, { width: 100, height: 50 });
    } catch (error) {
      console.error('Error embedding logo in PDF:', error.message);
    }
  }

  doc.fontSize(24).text(storeName, 0, 30, { align: 'center' });
  doc.fontSize(18).text('Daily Transaction Report', 0, 70, { align: 'center' });
  doc.fontSize(12).fillColor('#374151').text(`Date: ${date.toISOString().split('T')[0]}`, 0, 95, { align: 'center' });
  doc.moveDown(2);

  // Summary Section
  doc.fillColor('#1e3a8a').fontSize(16).font('Helvetica-Bold').text('Summary', 40, doc.y, { underline: true });
  doc.moveDown(0.5);
  doc.font('Helvetica').fillColor('#111827');

  const summaryY = doc.y;
  doc.lineWidth(1).rect(40, summaryY, 515, 100).stroke(); // Increased height for new fields
  doc.fontSize(12)
    .text(`Opening Balance: ${formatCurrency(openingBalance)}`, 50, summaryY + 10)
    .text(`Total Receivables: ${formatCurrency(totalReceivables)}`, 50, summaryY + 30)
    .text(`Total Payables: ${formatCurrency(totalPayables)}`, 50, summaryY + 50)
    .text(`Daily Balance: ${formatCurrency(dailyBalance)}`, 300, summaryY + 10)
    .text(`Closing Balance: ${formatCurrency(closingBalance)}`, 300, summaryY + 30);
  doc.moveDown(5);

  // Transactions Table
  doc.fillColor('#1e3a8a').fontSize(16).font('Helvetica-Bold').text('Transactions', 40, doc.y, { underline: true });
  doc.moveDown(0.8);

  // Table Header
  const tableTop = doc.y;
  doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold');
  doc.rect(40, tableTop, 515, 25).fill('#1e3a8a').stroke();
  doc.fillColor('#ffffff')
    .text('Customer', 50, tableTop + 8, { width: 130 })
    .text('Type', 190, tableTop + 8, { width: 80 })
    .text('Amount', 280, tableTop + 8, { width: 100 })
    .text('Description', 390, tableTop + 8, { width: 165 });
  doc.moveDown(0.5);

  // Table Rows
  let currentY = doc.y;
  doc.font('Helvetica').fillColor('#111827').fontSize(10);
  transactions.forEach((t, index) => {
    const customerName = (t.customerId?.name || 'Unknown Customer').substring(0, 50);
    const transactionType = t.transactionType || 'N/A';
    const amount = formatCurrency(t.transactionType === 'payable' ? t.payable : t.receivable);
    const description = (t.description || '').substring(0, 100);

    // Calculate row height
    const customerLines = doc.heightOfString(customerName, { width: 130, fontSize: 10 });
    const typeLines = doc.heightOfString(transactionType, { width: 80, fontSize: 10 });
    const amountLines = doc.heightOfString(amount, { width: 100, fontSize: 10 });
    const descLines = doc.heightOfString(description, { width: 165, fontSize: 10 });
    const rowHeight = Math.max(customerLines, typeLines, amountLines, descLines, 20) + 10;

    // Log row details for debugging
    console.log(`Row ${index + 1}:`, {
      customer: customerName,
      type: transactionType,
      amount,
      description,
      rowHeight,
    });

    const rowColor = index % 2 === 0 ? '#f3f4f6' : '#ffffff';
    doc.rect(40, currentY, 515, rowHeight).fill(rowColor).stroke();
    doc.fillColor('#111827')
      .text(customerName, 50, currentY + 5, { width: 130, lineBreak: true })
      .text(transactionType, 190, currentY + 5, { width: 80, lineBreak: true })
      .text(amount, 280, currentY + 5, { width: 100, lineBreak: true })
      .text(description, 390, currentY + 5, { width: 165, lineBreak: true });
    currentY += rowHeight + 5;
  });

  // Handle pagination
  if (currentY > doc.page.height - 100) {
    doc.addPage();
    currentY = 40;
  }

  // Footer
  doc.moveDown(2);
  doc.fillColor('#6b7280').fontSize(10).text(`Generated by ${storeName}`, 0, doc.y, { align: 'center' });
  doc.text(`Report Date: ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Karachi' })}`, 0, doc.y + 15, { align: 'center' });

  doc.end();

  const pdfBuffer = await new Promise((resolve) => {
    doc.on('end', () => {
      resolve(Buffer.concat(buffers));
    });
  });

  // Upload to Vercel Blob
  const { url } = await put(`reports/${fileName}`, pdfBuffer, {
    access: 'public',
    token: process.env.BLOB_READ_WRITE_TOKEN,
    addRandomSuffix: true,
  });

  return url;
}

module.exports = { generateDailyReport };