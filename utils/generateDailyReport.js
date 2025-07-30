// backend/utils/generateDailyReport.js
const PDFDocument = require('pdfkit');
const { put } = require('@vercel/blob');
const Transaction = require('../models/Transaction');
const Setting = require('../models/Setting');
const axios = require('axios');

// Constants for better maintainability
const COLORS = {
  PRIMARY: '#1e3a8a',
  SUCCESS: '#22c55e',
  DANGER: '#ef4444',
  TEXT: '#111827',
  GRAY: '#374151',
  LIGHT_GRAY: '#6b7280',
  WHITE: '#ffffff',
  LIGHT_GREEN: '#f0fdf4',
  LIGHT_RED: '#fef2f2'
};

const TABLE_CONFIG = {
  X: 40,
  WIDTH: 515,
  HEADER_HEIGHT: 25,
  ROW_PADDING: 10,
  MIN_ROW_HEIGHT: 20,
  COLUMNS: {
    CUSTOMER: { x: 50, width: 100 },
    TOTAL_AMOUNT: { x: 140, width: 80 },
    AMOUNT: { x: 250, width: 80 },
    REMAINING: { x: 360, width: 80 },
    DESCRIPTION: { x: 470, width: 100 }
  }
};


const formatCurrency = (value) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'PKR',
  }).format(value || 0);
};

// Optimized logo fetching with better error handling
async function fetchLogo(logoUrl) {
  if (!logoUrl) return null;
  
  try {
    const response = await axios.get(logoUrl, { 
      responseType: 'arraybuffer',
      timeout: 5000,
      maxContentLength: 5 * 1024 * 1024, // 5MB limit
      headers: {
        'User-Agent': 'Daily-Report-Generator/1.0'
      }
    });
    return Buffer.from(response.data);
  } catch (error) {
    console.warn('Logo fetch failed:', error.message);
    return null;
  }
}

// Optimized transaction totals calculation
function calculateTotals(transactions) {
  let receivables = 0, payables = 0, sellCount = 0, expenseCount = 0;
  
  for (const transaction of transactions) {
    if (transaction.transactionType === 'receivable') {
      receivables += transaction.receivable || 0;
      sellCount++;
    } else if (transaction.transactionType === 'payable') {
      payables += transaction.payable || 0;
      expenseCount++;
    }
  }
  
  return { receivables, payables, sellCount, expenseCount };
}

// Enhanced table header drawing
function drawTableHeader(doc, y, color) {
  const { X, WIDTH, HEADER_HEIGHT, COLUMNS } = TABLE_CONFIG;
  
  doc.fillColor(COLORS.WHITE).fontSize(10).font('Helvetica-Bold');
  doc.rect(X, y, WIDTH, HEADER_HEIGHT).fill(color).stroke();
  
  doc.fillColor(COLORS.WHITE)
    .text('Customer', COLUMNS.CUSTOMER.x, y + 8, { width: COLUMNS.CUSTOMER.width })
    .text('Total Amount', COLUMNS.TOTAL_AMOUNT.x, y + 8, { width: COLUMNS.TOTAL_AMOUNT.width })
    .text('Paid/Received', COLUMNS.AMOUNT.x, y + 8, { width: COLUMNS.AMOUNT.width })
    .text('Remaining', COLUMNS.REMAINING.x, y + 8, { width: COLUMNS.REMAINING.width })
    .text('Description', COLUMNS.DESCRIPTION.x, y + 8, { width: COLUMNS.DESCRIPTION.width });
    
  return y + HEADER_HEIGHT + 5;
}

// Optimized table row drawing with better data handling
function drawTableRow(doc, transaction, index, currentY, type, rowColor1) {
  const { X, WIDTH, ROW_PADDING, MIN_ROW_HEIGHT, COLUMNS } = TABLE_CONFIG;
  
  // Prepare data with safe fallbacks
  const customerName = (transaction.customerId?.name || 'Unknown Customer').substring(0, 40);
  const transactionType = type;
  const totalAmount = formatCurrency(transaction.totalAmount);
  const paidAmount = type === 'Sell' ? transaction.receivable : transaction.payable;
  const amount = formatCurrency(paidAmount);
  const remainingAmount = formatCurrency((transaction.totalAmount || 0) - (paidAmount || 0));
  const description = (transaction.description || 'N/A').substring(0, 20);

  // Calculate dynamic row height efficiently
  const textHeights = [
    doc.heightOfString(customerName, { width: COLUMNS.CUSTOMER.width, fontSize: 10 }),
    doc.heightOfString(totalAmount, { width: COLUMNS.TOTAL_AMOUNT.width, fontSize: 10 }),
    doc.heightOfString(amount, { width: COLUMNS.AMOUNT.width, fontSize: 10 }),
    doc.heightOfString(remainingAmount, { width: COLUMNS.REMAINING.width, fontSize: 10 }),
    doc.heightOfString(description, { width: COLUMNS.DESCRIPTION.width, fontSize: 10 })
  ];
  
  const rowHeight = Math.max(...textHeights, MIN_ROW_HEIGHT) + ROW_PADDING;
  const rowColor = index % 2 === 0 ? rowColor1 : COLORS.WHITE;

  // Draw row background and content
  doc.rect(X, currentY, WIDTH, rowHeight).fill(rowColor).stroke();
  doc.fillColor(COLORS.TEXT).fontSize(10)
    .text(customerName, COLUMNS.CUSTOMER.x, currentY + 5, { width: COLUMNS.CUSTOMER.width, lineBreak: true })
    .text(totalAmount, COLUMNS.TOTAL_AMOUNT.x, currentY + 5, { width: COLUMNS.TOTAL_AMOUNT.width, lineBreak: true })
    .text(amount, COLUMNS.AMOUNT.x, currentY + 5, { width: COLUMNS.AMOUNT.width, lineBreak: true })
    .text(remainingAmount, COLUMNS.REMAINING.x, currentY + 5, { width: COLUMNS.REMAINING.width, lineBreak: true })
    .text(description, COLUMNS.DESCRIPTION.x, currentY + 5, { width: COLUMNS.DESCRIPTION.width, lineBreak: true });

  return currentY + rowHeight + 5;
}

// Enhanced pagination check with header space reservation
function checkPagination(doc, currentY, needsHeader = false) {
  const spaceNeeded = needsHeader ? 100 : 50;
  if (currentY > doc.page.height - spaceNeeded) {
    doc.addPage();
    return 40;
  }
  return currentY;
}

// Optimized section rendering
function renderTransactionSection(doc, transactions, sectionTitle, type, headerColor, rowColor) {
  let currentY = doc.y;
  
  // Section title
  doc.fillColor(headerColor).fontSize(16).font('Helvetica-Bold')
    .text(sectionTitle, TABLE_CONFIG.X, currentY, { underline: true });
  doc.moveDown(0.8);

  // Table header
  currentY = drawTableHeader(doc, doc.y, headerColor);
  doc.font('Helvetica').fillColor(COLORS.TEXT).fontSize(10);

  if (transactions.length === 0) {
    doc.text(`No ${type.toLowerCase()} transactions for this date.`, TABLE_CONFIG.X + 10, currentY + 5);
    return checkPagination(doc, currentY + 30);
  }

  // Render rows
  for (let i = 0; i < transactions.length; i++) {
    currentY = checkPagination(doc, currentY, true);
    currentY = drawTableRow(doc, transactions[i], i, currentY, type, rowColor);
  }

  return checkPagination(doc, currentY + 20);
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
      }).populate('customerId', 'name').lean(), // Use lean() for better performance
      Transaction.find({
        date: { $lt: startOfDay },
      }).lean(),
      Setting.findOne().lean()
    ]);

    if (!settings) {
      throw new Error('Settings not found');
    }

    // Calculate opening balance efficiently
    const previousTotals = calculateTotals(previousTransactions);
 let openingBalance = 0;
    if (previousTransactions.length > 0) {
      const previousTotals = calculateTotals(previousTransactions);
      openingBalance = previousTotals.receivables - previousTotals.payables;
    } else {
      // Use stored opening balance if no prior transactions
      openingBalance = settings.openingBalance !== null ? settings.openingBalance : 0;
    }
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
      bufferPages: true // Enable page buffering for better performance
    });
    const fileName = `daily_report_${date.toISOString().split('T')[0]}.pdf`;

    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));

    // Header Section
    doc.fillColor('#1e3a8a').font('Helvetica-Bold');
    
    // Add logo if available
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

    // Summary Section with bold text
    doc.fillColor('#1e3a8a').fontSize(16).font('Helvetica-Bold').text('Summary', 40, doc.y, { underline: true });
    doc.moveDown(0.5);

    const summaryY = doc.y;
    doc.lineWidth(1).rect(40, summaryY, 515, 120).stroke();
    
    // Make all summary text bold
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#111827')
      .text(`Opening Balance: ${formatCurrency(openingBalance)}`, 50, summaryY + 10)
      .fillColor('#22c55e').text(`Total Sells (${sellCount}): ${formatCurrency(totalSells)}`, 50, summaryY + 30)
      .fillColor('#ef4444').text(`Total Expenses (${expenseCount}): ${formatCurrency(totalExpenses)}`, 50, summaryY + 50)
      .fillColor('#111827').text(`Daily Balance: ${formatCurrency(dailyBalance)}`, 300, summaryY + 10)
      .text(`Closing Balance: ${formatCurrency(closingBalance)}`, 300, summaryY + 30);
    
    doc.moveDown(8);

    // Render transaction sections efficiently
    doc.y = renderTransactionSection(
      doc, sellTransactions, 'Sales Transactions', 'Sell', 
      COLORS.SUCCESS, COLORS.LIGHT_GREEN
    );

    doc.y = renderTransactionSection(
      doc, expenseTransactions, 'Expense Transactions', 'Expense', 
      COLORS.DANGER, COLORS.LIGHT_RED
    );

    // Footer
    doc.moveDown(2);
    doc.fillColor('#6b7280').fontSize(10).font('Helvetica')
      .text(`Generated by ${storeName}`, 0, doc.y, { align: 'center' });
    doc.text(`Report Date: ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Karachi' })}`, 0, doc.y + 15, { align: 'center' });

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
    

    return url;

  } catch (error) {
    console.error('Error generating daily report:', error);
    throw new Error(`Failed to generate daily report: ${error.message}`);
  }
}

module.exports = { generateDailyReport };