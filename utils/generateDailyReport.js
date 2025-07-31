// backend/utils/generateDailyReport.js
const PDFDocument = require('pdfkit');
const { put } = require('@vercel/blob');
const Transaction = require('../models/Transaction');
const Setting = require('../models/Setting');
const axios = require('axios');

// Enhanced color scheme for better visual appeal
const COLORS = {
  PRIMARY: '#1e3a8a',
  HEADER_BLUE: '#2563eb',
  SUCCESS: '#22c55e',
  DANGER: '#ef4444',
  TEXT: '#111827',
  GRAY: '#374151',
  LIGHT_GRAY: '#f8f9fa',
  WHITE: '#ffffff',
  BORDER: '#d1d5db',
  SUMMARY_BG: '#f0f9ff',
  ACCENT: '#0ea5e9'
};

const PAGE_CONFIG = {
  MARGIN: 40,
  WIDTH: 515,
  HEIGHT: 750 // Increased for better content fitting
};

const HEADER_CONFIG = {
  LOGO_WIDTH: 80,
  LOGO_HEIGHT: 60,
  COMPANY_FONT_SIZE: 16, // Increased for better visibility
  ADDRESS_FONT_SIZE: 9,
  TITLE_FONT_SIZE: 18
};

const TABLE_CONFIG = {
  X: 40,
  WIDTH: 515,
  HEADER_HEIGHT: 28,
  ROW_HEIGHT: 22,
  COLUMNS: {
    DATE: { x: 50, width: 80, align: 'left' },
    PARTICULARS: { x: 130, width: 140, align: 'left' }, // Reduced width
    DEBIT: { x: 270, width: 80, align: 'right' }, // Moved closer
    CREDIT: { x: 350, width: 80, align: 'right' },
    BALANCE: { x: 440, width: 80, align: 'right' }
  }
};

const formatCurrency = (value) => {
  if (!value || value === 0) return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'PKR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.abs(value));
};

const formatDate = (date) => {
  return new Date(date).toLocaleDateString('en-GB');
};

// Optimized logo fetching
async function fetchLogo(logoUrl) {
  if (!logoUrl) return null;
  
  try {
    const response = await axios.get(logoUrl, { 
      responseType: 'arraybuffer',
      timeout: 5000,
      maxContentLength: 5 * 1024 * 1024,
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

// Calculate running balance with optimization
function calculateRunningBalance(transactions, openingBalance) {
  let runningBalance = openingBalance;
  const processedTransactions = [];
  
  // Sort transactions by date for chronological order
  const sortedTransactions = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));
  
  for (const transaction of sortedTransactions) {
    const debit = transaction.transactionType === 'payable' ? (transaction.payable || 0) : 0;
    const credit = transaction.transactionType === 'receivable' ? (transaction.receivable || 0) : 0;
    
    runningBalance += credit - debit;
    
    processedTransactions.push({
      ...transaction,
      debit,
      credit,
      runningBalance
    });
  }
  
  return processedTransactions;
}

// Enhanced company header with better styling
function drawCompanyHeader(doc, settings, logoBuffer, reportDate) {
  const { LOGO_WIDTH, LOGO_HEIGHT, COMPANY_FONT_SIZE, ADDRESS_FONT_SIZE } = HEADER_CONFIG;
  
  // Add subtle background for header
  doc.rect(40, 15, 515, 85)
     .fillColor('#fafbfc')
     .fill()
     .strokeColor(COLORS.BORDER)
     .lineWidth(0.5)
     .stroke();
  
  // Company logo (left side)
  if (logoBuffer) {
    try {
      doc.image(logoBuffer, 50, 25, { width: LOGO_WIDTH, height: LOGO_HEIGHT });
    } catch (error) {
      console.error('Error embedding logo:', error.message);
    }
  }
  
  // Company name and details (right side)
  const companyName = (settings.siteName || 'YOUR COMPANY NAME').toUpperCase();

  
  doc.font('Helvetica-Bold')
     .fontSize(COMPANY_FONT_SIZE)
     .fillColor(COLORS.PRIMARY)
     .text(companyName, 280, 30, { width: 270, align: 'right' });

      doc.font('Helvetica')
     .fontSize(ADDRESS_FONT_SIZE)
     .fillColor(COLORS.TEXT)
     .text(`Report Date: ${formatDate(reportDate)}`, 280, 50, { width: 270, align: 'right' })

  
  return 115;
}

// Enhanced summary section from first code
function drawSummarySection(doc, currentY, totals, sellCount, expenseCount, openingBalance) {
  const summaryHeight = 140;
  
  // Summary section background with gradient effect
  doc.rect(40, currentY, 515, summaryHeight)
     .fillColor(COLORS.SUMMARY_BG)
     .fill()
     .strokeColor(COLORS.ACCENT)
     .lineWidth(2)
     .stroke();
  
  // Summary title
  doc.font('Helvetica-Bold')
     .fontSize(16)
     .fillColor(COLORS.PRIMARY)
     .text('DAILY SUMMARY', 50, currentY + 15);
  
  // Left column
  doc.font('Helvetica-Bold')
     .fontSize(12)
     .fillColor(COLORS.TEXT)
     .text(`Opening Balance: ${formatCurrency(openingBalance)}`, 50, currentY + 45)
     .fillColor(COLORS.SUCCESS)
     .text(`Total Sales (${sellCount}): ${formatCurrency(totals.totalCredits)}`, 50, currentY + 70)
     .fillColor(COLORS.DANGER)
     .text(`Total Expenses (${expenseCount}): ${formatCurrency(totals.totalDebits)}`, 50, currentY + 95);
  
  // Right column
  const dailyBalance = totals.totalCredits - totals.totalDebits;
  const closingBalance = openingBalance + dailyBalance;
  
  doc.fillColor(COLORS.TEXT)
     .text(`Daily Balance: ${formatCurrency(dailyBalance)}`, 300, currentY + 45)
     .text(`Closing Balance: ${formatCurrency(closingBalance)}`, 300, currentY + 70);
  
  // Add decorative elements

  
  return currentY + summaryHeight + 20;
}

// Draw customer and report information with better styling
function drawReportInfo(doc, reportDate, currentY) {
  const infoHeight = 0;
  
  // Background for report info

  
  return currentY + infoHeight + 15;
}

// Enhanced table header
function drawTableHeader(doc, currentY) {
  const { X, WIDTH, HEADER_HEIGHT, COLUMNS } = TABLE_CONFIG;
  
  // Header background with gradient effect
  doc.rect(X, currentY, WIDTH, HEADER_HEIGHT)
     .fillColor(COLORS.PRIMARY)
     .fill();
  
  // Header text
  doc.font('Helvetica-Bold')
     .fontSize(11)
     .fillColor(COLORS.WHITE);
  
  doc.text('DATE', COLUMNS.DATE.x, currentY + 9, { width: COLUMNS.DATE.width, align: COLUMNS.DATE.align });
  doc.text('PARTICULARS', COLUMNS.PARTICULARS.x, currentY + 9, { width: COLUMNS.PARTICULARS.width, align: COLUMNS.PARTICULARS.align });
  doc.text('DEBIT', COLUMNS.DEBIT.x, currentY + 9, { width: COLUMNS.DEBIT.width, align: COLUMNS.DEBIT.align });
  doc.text('CREDIT', COLUMNS.CREDIT.x, currentY + 9, { width: COLUMNS.CREDIT.width, align: COLUMNS.CREDIT.align });
  doc.text('BALANCE', COLUMNS.BALANCE.x, currentY + 9, { width: COLUMNS.BALANCE.width, align: COLUMNS.BALANCE.align });
  
  return currentY + HEADER_HEIGHT;
}

// Enhanced opening balance row
function drawOpeningBalanceRow(doc, currentY, openingBalance) {
  const { X, WIDTH, ROW_HEIGHT, COLUMNS } = TABLE_CONFIG;
  
  doc.rect(X, currentY, WIDTH, ROW_HEIGHT)
     .fillColor('#e0f2fe')
     .fill()
     .strokeColor(COLORS.BORDER)
     .stroke();
  
  doc.font('Helvetica-Bold')
     .fontSize(10)
     .fillColor(COLORS.TEXT);
  
  doc.text(formatDate(new Date()), COLUMNS.DATE.x, currentY + 7, { width: COLUMNS.DATE.width, align: COLUMNS.DATE.align });
  doc.text('Opening Balance', COLUMNS.PARTICULARS.x, currentY + 7, { width: COLUMNS.PARTICULARS.width, align: COLUMNS.PARTICULARS.align });
  doc.text('', COLUMNS.DEBIT.x, currentY + 7, { width: COLUMNS.DEBIT.width, align: COLUMNS.DEBIT.align });
  doc.text('', COLUMNS.CREDIT.x, currentY + 7, { width: COLUMNS.CREDIT.width, align: COLUMNS.CREDIT.align });
  doc.text(formatCurrency(openingBalance), COLUMNS.BALANCE.x, currentY + 7, { width: COLUMNS.BALANCE.width, align: COLUMNS.BALANCE.align });
  
  return currentY + ROW_HEIGHT;
}

// Enhanced transaction row
function drawTransactionRow(doc, currentY, transaction, index) {
  const { X, WIDTH, ROW_HEIGHT, COLUMNS } = TABLE_CONFIG;
  const isEven = index % 2 === 0;
  const rowColor = isEven ? COLORS.WHITE : '#f8fafc';
  
  // Draw row background
  doc.rect(X, currentY, WIDTH, ROW_HEIGHT)
     .fillColor(rowColor)
     .fill()
     .strokeColor(COLORS.BORDER)
     .lineWidth(0.5)
     .stroke();
  
  doc.font('Helvetica')
     .fontSize(10)
     .fillColor(COLORS.TEXT);
  
  const date = formatDate(transaction.date);
  const customerName = transaction.customerId?.name || 'Unknown';
  let description = `${customerName} - ${transaction.description || 'Transaction'}`;
  
  // Truncate description with ellipsis
  const maxChars = 28; // Adjusted for new column width
  if (description.length > maxChars) {
    description = description.substring(0, maxChars - 3) + '...';
  }
  
  const debitAmount = transaction.debit > 0 ? formatCurrency(transaction.debit) : '';
  const creditAmount = transaction.credit > 0 ? formatCurrency(transaction.credit) : '';
  const balance = formatCurrency(transaction.runningBalance);
  
  // Draw text
  doc.text(date, COLUMNS.DATE.x, currentY + 7, { 
    width: COLUMNS.DATE.width, 
    align: COLUMNS.DATE.align 
  });
  doc.text(description, COLUMNS.PARTICULARS.x, currentY + 7, { 
    width: COLUMNS.PARTICULARS.width, 
    align: COLUMNS.PARTICULARS.align 
  });
  
  // Color coding for amounts
  if (transaction.debit > 0) doc.fillColor(COLORS.DANGER);
  doc.text(debitAmount, COLUMNS.DEBIT.x, currentY + 7, { 
    width: COLUMNS.DEBIT.width, 
    align: COLUMNS.DEBIT.align 
  });
  
  if (transaction.credit > 0) doc.fillColor(COLORS.SUCCESS);
  doc.text(creditAmount, COLUMNS.CREDIT.x, currentY + 7, { 
    width: COLUMNS.CREDIT.width, 
    align: COLUMNS.CREDIT.align 
  });
  
  doc.fillColor(COLORS.TEXT);
  doc.text(balance, COLUMNS.BALANCE.x, currentY + 7, { 
    width: COLUMNS.BALANCE.width, 
    align: COLUMNS.BALANCE.align 
  });
  
  return currentY + ROW_HEIGHT;
}

// Optimized page check to avoid unnecessary pages
function checkNewPage(doc, currentY, spaceNeeded = 40) {
  if (currentY + spaceNeeded > PAGE_CONFIG.HEIGHT) {
    doc.addPage();
    return PAGE_CONFIG.MARGIN;
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
      }).populate('customerId', 'name').lean(),
      Transaction.find({
        date: { $lt: startOfDay },
      }).lean(),
      Setting.findOne().lean()
    ]);

    if (!settings) {
      throw new Error('Settings not found');
    }

    // Calculate opening balance efficiently
    let openingBalance = 0;
    if (previousTransactions.length > 0) {
      const previousTotals = previousTransactions.reduce((acc, t) => {
        if (t.transactionType === 'receivable') acc.credits += (t.receivable || 0);
        if (t.transactionType === 'payable') acc.debits += (t.payable || 0);
        return acc;
      }, { credits: 0, debits: 0 });
      openingBalance = previousTotals.credits - previousTotals.debits;
    } else {
      openingBalance = settings.openingBalance || 0;
    }

    // Process transactions with running balance
    const processedTransactions = calculateRunningBalance(transactions, openingBalance);

    // Calculate totals and counts
    const totals = processedTransactions.reduce((acc, t) => {
      acc.totalDebits += t.debit;
      acc.totalCredits += t.credit;
      return acc;
    }, { totalDebits: 0, totalCredits: 0 });
    
    const sellCount = transactions.filter(t => t.transactionType === 'receivable').length;
    const expenseCount = transactions.filter(t => t.transactionType === 'payable').length;

    // Fetch logo
    const logoBuffer = await fetchLogo(settings.logo);

    // Create PDF document
  const doc = new PDFDocument({ 
      margin: PAGE_CONFIG.MARGIN,
      size: [595.28, 841.89], // A4 size in points
      bufferPages: true // Enable page buffering
    });
    
    const fileName = `daily_statement_${date.toISOString().split('T')[0]}.pdf`;
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));

    // Draw sections
    let currentY = drawCompanyHeader(doc, settings, logoBuffer, date);
    currentY = checkNewPage(doc, currentY, 100);
    currentY = drawReportInfo(doc, date, currentY);
    currentY = checkNewPage(doc, currentY, 160);
    currentY = drawSummarySection(doc, currentY, totals, sellCount, expenseCount, openingBalance);
    
    // Transactions section
    if (processedTransactions.length > 0) {
      currentY = checkNewPage(doc, currentY, TABLE_CONFIG.HEADER_HEIGHT + TABLE_CONFIG.ROW_HEIGHT);
      currentY = drawTableHeader(doc, currentY);
      currentY = drawOpeningBalanceRow(doc, currentY, openingBalance);
      
      for (let i = 0; i < processedTransactions.length; i++) {
        currentY = checkNewPage(doc, currentY, TABLE_CONFIG.ROW_HEIGHT);
        currentY = drawTransactionRow(doc, currentY, processedTransactions[i], i);
      }
    } else {
      currentY = checkNewPage(doc, currentY, 40);
      doc.font('Helvetica')
         .fontSize(12)
         .fillColor(COLORS.GRAY)
         .text('No transactions found for this date.', 0, currentY, { align: 'center' });
    }
    
    // Add footer on all pages
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.font('Helvetica')
         .fontSize(8)
         .fillColor(COLORS.GRAY)
         .text(`Generated on ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Karachi' })}`, 
                PAGE_CONFIG.MARGIN, 
                doc.page.height - PAGE_CONFIG.MARGIN - 20, 
                { align: 'center' })
         .text('Sharplogicians.', 
                PAGE_CONFIG.MARGIN, 
                doc.page.height - PAGE_CONFIG.MARGIN - 10, 
                { align: 'center' });
    }

    doc.end();

    // Generate PDF buffer
    const pdfBuffer = await new Promise((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);
    });

    // Upload to Vercel Blob
    const { url } = await put(`reports/${fileName}`, pdfBuffer, {
      access: 'public',
      token: process.env.BLOB_READ_WRITE_TOKEN,
      addRandomSuffix: true,
    });

    return url;

  } catch (error) {
    console.error('Error generating daily report:', error);
    throw new Error(`Failed to generate daily report: ${error.message}`);
  }
}

module.exports = { generateDailyReport}