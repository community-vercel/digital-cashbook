// backend/utils/generateDailyReport.js
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

// Helper function to fetch logo with caching
async function fetchLogo(logoUrl) {
  if (!logoUrl) return null;
  try {
    const response = await axios.get(logoUrl, {
      responseType: 'arraybuffer',
      timeout: 5000,
    });
    return Buffer.from(response.data);
  } catch (error) {
    console.error('Error fetching logo:', error.message);
    return null;
  }
}

// Helper function to calculate transaction totals
function calculateTotals(transactions) {
  return transactions.reduce(
    (acc, transaction) => {
      if (transaction.transactionType === 'receivable') {
        acc.receivables += transaction.receivable || 0;
        acc.sellCount++;
      } else if (transaction.transactionType === 'payable') {
        acc.payables += transaction.payable || 0;
        acc.expenseCount++;
      }
      return acc;
    },
    { receivables: 0, payables: 0, sellCount: 0, expenseCount: 0 }
  );
}

// Helper function to draw table header
function drawTableHeader(doc, y, title, color) {
  doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold');
  doc.rect(40, y, 515, 25).fill(color).stroke();
  doc.fillColor('#ffffff')
    .text('Customer', 50, y + 8, { width: 100 }) // Reduced width
    .text('Type', 160, y + 8, { width: 60 }) // Reduced width
    .text('Total Amount', 230, y + 8, { width: 80 }) // New column
    .text('Amount', 320, y + 8, { width: 80 }) // Renamed from 'Amount'
    .text('Remaining', 410, y + 8, { width: 80 }) // New column
    .text('Description', 480, y + 8, { width: 100 }); // Reduced width
  return y + 30;
}

// Helper function to draw table row
function drawTableRow(doc, transaction, index, currentY, type, rowColor1, rowColor2) {
  const customerName = (transaction.customerId?.name || 'Unknown Customer').substring(0, 40);
  const transactionType = type;
  const totalAmount = formatCurrency(transaction.totalAmount || 0);
  const amount = formatCurrency(
    type === 'Sell' ? transaction.receivable || 0 : transaction.payable || 0
  );
  const remainingAmount = formatCurrency(
    transaction.totalAmount - (type === 'Sell' ? transaction.receivable || 0 : transaction.payable || 0)
  );
  const description = (transaction.description || '').substring(0, 30);

  // Calculate row height based on content
  const customerLines = doc.heightOfString(customerName, { width: 100, fontSize: 10 });
  const typeLines = doc.heightOfString(transactionType, { width: 60, fontSize: 10 });
  const totalAmountLines = doc.heightOfString(totalAmount, { width: 80, fontSize: 10 });
  const amountLines = doc.heightOfString(amount, { width: 80, fontSize: 10 });
  const remainingLines = doc.heightOfString(remainingAmount, { width: 80, fontSize: 10 });
  const descLines = doc.heightOfString(description, { width: 45, fontSize: 10 });
  const rowHeight = Math.max(
    customerLines,
    typeLines,
    totalAmountLines,
    amountLines,
    remainingLines,
    descLines,
    20
  ) + 10;

  const rowColor = index % 2 === 0 ? rowColor1 : '#ffffff';
  doc.rect(40, currentY, 515, rowHeight).fill(rowColor).stroke();
  doc.fillColor('#111827')
    .text(customerName, 50, currentY + 5, { width: 100, lineBreak: true })
    .text(transactionType, 160, currentY + 5, { width: 60, lineBreak: true })
    .text(totalAmount, 230, currentY + 5, { width: 80, lineBreak: true })
    .text(amount, 320, currentY + 5, { width: 80, lineBreak: true })
    .text(remainingAmount, 410, currentY + 5, { width: 80, lineBreak: true })
    .text(description, 500, currentY + 5, { width: 45, lineBreak: true });

  console.log(`${type} Row ${index + 1}:`, {
    customer: customerName,
    type: transactionType,
    totalAmount,
    amount,
    remainingAmount,
    description,
    rowHeight,
  });

  return currentY + rowHeight + 5;
}

// Helper function to check pagination
function checkPagination(doc, currentY) {
  if (currentY > doc.page.height - 100) {
    doc.addPage();
    return 40;
  }
  return currentY;
}

async function generateDailyReport(date) {
  try {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    // Parallel data fetching for better performance
    const [transactions, previousTransactions, settings] = await Promise.all([
      Transaction.find({
        date: { $gte: startOfDay, $lte: endOfDay },
      })
        .populate('customerId', 'name')
        .lean(),
      Transaction.find({
        date: { $lt: startOfDay },
      }).lean(),
      Setting.findOne().lean(),
    ]);

    if (!settings) {
      throw new Error('Settings not found');
    }

    // Calculate opening balance
    const previousTotals = calculateTotals(previousTransactions);
    const openingBalance = previousTotals.receivables - previousTotals.payables;

    // Separate transactions
    const sellTransactions = transactions.filter((t) => t.transactionType === 'receivable');
    const expenseTransactions = transactions.filter((t) => t.transactionType === 'payable');

    // Calculate daily totals
    const totalSells = sellTransactions.reduce((sum, t) => sum + (t.receivable || 0), 0);
    const totalExpenses = expenseTransactions.reduce((sum, t) => sum + (t.payable || 0), 0);
    const dailyBalance = totalSells - totalExpenses;
    const closingBalance = openingBalance + dailyBalance;

    // Get counts
    const sellCount = sellTransactions.length;
    const expenseCount = expenseTransactions.length;

    // Fetch logo and store name
    const storeName = settings.siteName || 'Your Store Name';
    const logoBuffer = await fetchLogo(settings.logo);

    // Create PDF document
    const doc = new PDFDocument({
      margin: 40,
      bufferPages: true,
    });
    const fileName = `daily_report_${date.toISOString().split('T')[0]}.pdf`;

    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));

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

    const summaryY = doc.y;
    doc.lineWidth(1).rect(40, summaryY, 515, 120).stroke();
    doc.font('Helvetica-Bold')
      .fontSize(12)
      .fillColor('#111827')
      .text(`Opening Balance: ${formatCurrency(openingBalance)}`, 50, summaryY + 10)
      .fillColor('#22c55e')
      .text(`Total Sells (${sellCount}): ${formatCurrency(totalSells)}`, 50, summaryY + 30)
      .fillColor('#ef4444')
      .text(`Total Expenses (${expenseCount}): ${formatCurrency(totalExpenses)}`, 50, summaryY + 50)
      .fillColor('#111827')
      .text(`Daily Balance: ${formatCurrency(dailyBalance)}`, 300, summaryY + 10)
      .text(`Closing Balance: ${formatCurrency(closingBalance)}`, 300, summaryY + 30);
    doc.moveDown(8);

    // Sells Section
    doc.fillColor('#22c55e').fontSize(16).font('Helvetica-Bold').text('Sells', 40, doc.y, { underline: true });
    doc.moveDown(0.8);

    let currentY = drawTableHeader(doc, doc.y, 'Sells', '#22c55e');
    doc.font('Helvetica').fillColor('#111827').fontSize(10);

    if (sellTransactions.length === 0) {
      doc.text('No sell transactions for this date.', 50, currentY + 5);
      currentY += 30;
    } else {
      sellTransactions.forEach((transaction, index) => {
        currentY = checkPagination(doc, currentY);
        currentY = drawTableRow(doc, transaction, index, currentY, 'Sell', '#f0fdf4', '#ffffff');
      });
    }

    currentY = checkPagination(doc, currentY + 20);

    // Expenses Section
       doc.fillColor('#ef4444').fontSize(16).font('Helvetica-Bold').text('Expenses', 40, currentY, { underline: true });
    doc.moveDown(0.9);

    currentY = drawTableHeader(doc, currentY, 'Expenses', '#ef4444');
    doc.font('Helvetica').fillColor('#111827').fontSize(10);

    if (expenseTransactions.length === 0) {
      doc.text('No expense transactions for this date.', 50, currentY + 5);
      currentY += 30;
    } else {
      expenseTransactions.forEach((transaction, index) => {
        currentY = checkPagination(doc, currentY);
        currentY = drawTableRow(doc, transaction, index, currentY, 'Expense', '#fef2f2', '#ffffff');
      });
    }

    // Footer
    doc.moveDown(2);
    doc
      .fillColor('#6b7280')
      .fontSize(10)
      .font('Helvetica')
      .text(`Generated by ${storeName}`, 0, doc.y, { align: 'center' })
      .text(`Report Date: ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Karachi' })}`, 0, doc.y + 15, {
        align: 'center',
      });

    doc.end();

    // Wait for PDF generation to complete
    const pdfBuffer = await new Promise((resolve, reject) => {
      doc.on('end', () => {
        resolve(Buffer.concat(buffers));
      });
      doc.on('error', reject);
    });

    // Upload to Vercel Blob
    const { url } = await put(`reports/${fileName}`, pdfBuffer, {
      access: 'public',
      token: process.env.BLOB_READ_WRITE_TOKEN,
      addRandomSuffix: true,
    });

    // Log summary for debugging
    console.log('Daily Report Generated:', {
      date: date.toISOString().split('T')[0],
      openingBalance,
      totalSells,
      totalExpenses,
      dailyBalance,
      closingBalance,
      sellCount,
      expenseCount,
      url,
    });

    return url;
  } catch (error) {
    console.error('Error generating daily report:', error);
    throw new Error(`Failed to generate daily report: ${error.message}`);
  }
}

module.exports = { generateDailyReport };