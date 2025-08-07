const Transaction = require('../models/Transaction');
const Customer = require('../models/Customer');
const Setting = require('../models/Setting');
const User = require('../models/User');
const Shop = require('../models/Shop');
const PDFKit = require('pdfkit');
const ExcelJS = require('exceljs');
const { put } = require('@vercel/blob');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const mongoose = require('mongoose');
const os = require('os');
// Helper function to safely parse dates as UTC
const parseUTCDate = (dateString, isEndOfDay = false) => {
  if (!dateString || typeof dateString !== 'string') {
    return null;
  }
  
  const cleanDateString = dateString.split('T')[0].trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDateString)) {
    throw new Error(`Invalid date format: ${dateString}. Expected YYYY-MM-DD`);
  }
  
  const timeString = isEndOfDay ? '23:59:59.999Z' : '00:00:00.000Z';
  const utcDateString = `${cleanDateString}T${timeString}`;
  const date = new Date(utcDateString);
  
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${dateString}`);
  }
  
  return date;
};

// Helper function to safely get numeric value
const getNumericValue = (value, defaultValue = 0) => {
  const num = Number(value);
  return (typeof num === 'number' && !isNaN(num)) ? num : defaultValue;
};

// Truncate description for reports
const truncateDescription = (description) => {
  if (!description) return 'N/A';
  const maxLength = 10;
  return description.length > maxLength ? description.slice(0, maxLength) + '...' : description;
};

exports.getSummaryReport = async (req, res) => {
  try {
    const { startDate, endDate, format, customerId, shopId } = req.query;

    // Check if req.user exists
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized: No user information provided' });
    }

    // Determine shop context based on user role and shopId
    let selectedShopId = req.user.shopId;
    let isAllShops = false;
    let shopSettings = null;
    let shopName = 'All Shops'; // Default for all shops

    if (req.user.role === 'superadmin' && shopId) {
      if (shopId === 'all') {
        isAllShops = true;
      } else if (mongoose.Types.ObjectId.isValid(shopId)) {
        selectedShopId = shopId;
      } else {
        return res.status(400).json({ error: 'Invalid shopId' });
      }
    }

    // Fetch settings based on shop context
    if (isAllShops) {
      // Aggregate opening balance across all shops
      const allSettings = await Setting.find({});
      if (allSettings.length === 0) {
        return res.status(404).json({ error: 'No shop settings found' });
      }
      const totalOpeningBalance = allSettings.reduce(
        (sum, setting) => sum + getNumericValue(setting.openingBalance),
        0
      );
      shopSettings = {
        openingBalance: totalOpeningBalance,
        siteName: 'All Shops',
        logo: allSettings[0]?.logo || '',
      };
    } else {
      if (!selectedShopId) {
        return res.status(400).json({ error: 'Shop ID required' });
      }
      shopSettings = await Setting.findOne({ shopId: selectedShopId });
      if (!shopSettings) {
        return res.status(404).json({ error: 'Settings not found for this shop' });
      }
      // Fetch shop name for single shop
      const shop = await Shop.findById(selectedShopId);
      shopName = shop?.name || shopSettings.siteName;
    }

    // Check if user is admin
    const user = await User.findById(req.user.id || req.user.userId || req.user._id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const isAdmin = user.role === 'admin' || user.role === 'superadmin';

    // Build query
    const query = {};
    if (!isAllShops) {
      query.shopId = selectedShopId; // Apply shopId filter only for single shop
    }

    // Parse and validate dates with UTC handling
    let startDateParsed = null;
    let endDateParsed = null;
    
    if (startDate || endDate) {
      try {
        if (startDate) {
          startDateParsed = parseUTCDate(startDate, false);
        }
        if (endDate) {
          endDateParsed = parseUTCDate(endDate, true);
        }
        if (startDateParsed && endDateParsed && startDateParsed > endDateParsed) {
          return res.status(400).json({ error: 'Start date cannot be after end date' });
        }
        if (startDateParsed && endDateParsed) {
          query.date = { $gte: startDateParsed, $lte: endDateParsed };
        } else if (startDateParsed) {
          query.date = { $gte: startDateParsed };
        } else if (endDateParsed) {
          query.date = { $lte: endDateParsed };
        }
      } catch (dateError) {
        return res.status(400).json({ error: dateError.message });
      }
    }

    // Add customer filter if provided
    if (customerId) {
      if (!mongoose.Types.ObjectId.isValid(customerId)) {
        return res.status(400).json({ error: 'Invalid customerId' });
      }
      query.customerId = customerId;
    }

    // Fetch transactions
    const transactions = await Transaction.find(query)
      .populate('customerId', 'name')
      .sort({ date: -1 });

    // Calculate totals
    const cleanAmount = getNumericValue;
    const totalReceivables = transactions
      .filter((t) => t.transactionType === 'receivable')
      .reduce((sum, t) => sum + cleanAmount(t.receivable), 0);
    const totalPayables = transactions
      .filter((t) => t.transactionType === 'payable')
      .reduce((sum, t) => sum + cleanAmount(t.payable), 0);

    // Calculate opening balance
    let openingBalance = 0;
    if (startDateParsed) {
      const openingBalanceQuery = { ...query, date: { $lt: startDateParsed } };
      const previousTransactions = await Transaction.find(openingBalanceQuery);
      if (previousTransactions.length > 0) {
        openingBalance = previousTransactions.reduce((sum, t) => {
          const receivable = cleanAmount(t.receivable);
          const payable = cleanAmount(t.payable);
          return sum + (t.transactionType === 'receivable' ? receivable : -payable);
        }, 0);
      } else {
        openingBalance = shopSettings.openingBalance !== null ? cleanAmount(shopSettings.openingBalance) : 0;
      }
    } else {
      openingBalance = shopSettings.openingBalance !== null ? cleanAmount(shopSettings.openingBalance) : 0;
    }

    // Category summary
    const categorySummary = {};
    transactions.forEach((t) => {
      const amount = t.transactionType === 'receivable' 
        ? cleanAmount(t.totalAmount) 
        : -cleanAmount(t.totalAmount);
      const categoryKey = t.category || 'Uncategorized';
      categorySummary[categoryKey] = (categorySummary[categoryKey] || 0) + amount;
    });

    // Calculate final balance
    const finalBalance = totalReceivables - totalPayables + openingBalance;

    // Prepare report data
    const reportData = {
      totalReceivables: Math.round(totalReceivables * 100) / 100,
      totalPayables: Math.round(totalPayables * 100) / 100,
      balance: Math.round(finalBalance * 100) / 100,
      openingBalance: Math.round(openingBalance * 100) / 100,
      categorySummary,
      transactions: transactions.map((t) => ({
        ...t.toObject(),
        type: t.transactionType,
        formattedDate: t.date ? t.date.toISOString().split('T')[0] : 'N/A',
      })),
      metadata: {
        dateRange: {
          startDate: startDateParsed ? startDateParsed.toISOString().split('T')[0] : null,
          endDate: endDateParsed ? endDateParsed.toISOString().split('T')[0] : null,
        },
        transactionCount: transactions.length,
        customerId: customerId || null,
        shopId: isAllShops ? 'all' : selectedShopId,
      },
    };

    // Generate PDF or Excel if requested
    if (format === 'pdf') {
      const PDFDocument = require('pdfkit');
      const { PDFDocument: PDFLibDocument } = require('pdf-lib');
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const filename = `report-${Date.now()}.pdf`;
      const filePath = path.join(os.tmpdir(), filename);

      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {});

      try {
        // Fetch logo
        let logoBuffer;
        try {
          const response = await axios.get(shopSettings.logo, { responseType: 'arraybuffer' });
          logoBuffer = Buffer.from(response.data);
        } catch (error) {
          console.error('Error fetching logo image:', error.message);
          logoBuffer = null;
        }

        // Page dimensions
        const pageWidth = 595;
        const pageHeight = 842;
        const leftMargin = 40;
        const rightMargin = 40;
        const topMargin = 40;
        const bottomMargin = 40;
        const headerHeight = logoBuffer ? 70 : 50;
        const footerHeight = 40;
        const usableWidth = pageWidth - leftMargin - rightMargin;
        let currentY = topMargin;

        // Helper function to add new page
        const addNewPage = () => {
          doc.addPage();
          currentY = topMargin;
          addHeader();
        };

        // Header function
        const addHeader = () => {
          if (logoBuffer) {
            try {
              const x = 40;
              const y = topMargin;
              const radius = 25;
              const diameter = radius * 2;
              doc.save();
              doc.circle(x + radius, y + radius, radius).clip();
              doc.image(logoBuffer, x, y, { width: diameter, height: diameter });
              doc.restore();
            } catch (error) {
              console.error('Error rendering logo image:', error.message);
              doc.font('Helvetica-Bold')
                .fontSize(16)
                .fillColor('#4f46e5')
                .text('Your Company', leftMargin, topMargin, { width: usableWidth, align: 'center' });
            }
          } else {
            doc.font('Helvetica-Bold')
              .fontSize(16)
              .fillColor('#4f46e5')
              .text('Your Company', leftMargin, topMargin, { width: usableWidth, align: 'center' });
          }

          doc.font('Helvetica-Bold')
            .fontSize(14)
            .fillColor('#1f2937')
            .text(shopName, leftMargin, topMargin + 20, { width: usableWidth, align: 'center' });

          if (customerId && transactions[0]?.customerId?.name) {
            doc.font('Helvetica')
              .fontSize(12)
              .fillColor('#374151')
              .text(`Customer: ${transactions[0].customerId.name}`, leftMargin, topMargin + 40, { width: usableWidth, align: 'center' });
          } else if (isAdmin) {
            doc.font('Helvetica')
              .fontSize(12)
              .fillColor('#374151')
              .text(isAllShops ? 'All Shops' : 'Shop Report', leftMargin, topMargin + 40, { width: usableWidth, align: 'center' });
          }

          doc.moveTo(leftMargin, topMargin + 50)
            .lineTo(pageWidth - rightMargin, topMargin + 50)
            .strokeColor('#e5e7eb')
            .stroke();

          currentY = topMargin + headerHeight;
        };

        // Footer function
        const addFooter = (pageNumber) => {
          doc.font('Helvetica')
            .fontSize(8)
            .fillColor('#6b7280')
            .text(shopName, leftMargin, pageHeight - bottomMargin - 30, { align: 'left' })
            .text(`Page ${pageNumber}`, pageWidth - rightMargin, pageHeight - bottomMargin - 30, { align: 'right' });
          doc.moveTo(leftMargin, pageHeight - bottomMargin - 40)
            .lineTo(pageWidth - rightMargin, pageHeight - bottomMargin - 40)
            .strokeColor('#e5e7eb')
            .stroke();
        };

        // Initialize first page
        addHeader();

        // Report period
        doc.font('Helvetica')
          .fontSize(10)
          .fillColor('#6b7280')
          .text(`Generated on: ${new Date().toLocaleDateString()}`, leftMargin, currentY);

        currentY += 20;
        doc.font('Helvetica-Bold')
          .fontSize(12)
          .fillColor('#1f2937')
          .text(
            `Period: ${startDate ? new Date(startDate).toLocaleDateString() : 'N/A'} to ${
              endDate ? new Date(endDate).toLocaleDateString() : 'N/A'
            }`,
            leftMargin,
            currentY
          );

        currentY += 30;

        // Summary box
        if (currentY + 105 > pageHeight - bottomMargin - footerHeight) {
          addNewPage();
        }
        doc.rect(leftMargin, currentY, usableWidth, 105)
          .fillAndStroke('#f9fafb', '#d1d5db');

        doc.font('Helvetica')
          .fontSize(11)
          .fillColor('#374151')
          .text('Summary', leftMargin + 10, currentY + 10)
          .text(`Opening Balance: ${cleanAmount(openingBalance).toFixed(2)}`, leftMargin + 10, currentY + 30)
          .text(`Total Receivables: ${cleanAmount(totalReceivables).toFixed(2)}`, leftMargin + 10, currentY + 45)
          .text(`Total Payables: ${cleanAmount(totalPayables).toFixed(2)}`, leftMargin + 10, currentY + 60)
          .fillColor(reportData.balance >= 0 ? '#10b981' : '#ef4444')
          .text(`Closing Balance: ${cleanAmount(reportData.balance).toFixed(2)}`, leftMargin + 10, currentY + 75);

        currentY += 125;

        // Category Summary
        if (currentY + 30 > pageHeight - bottomMargin - footerHeight) {
          addNewPage();
        }
        doc.font('Helvetica-Bold')
          .fontSize(12)
          .fillColor('#1f2937')
          .text('Category Summary', leftMargin, currentY);
        currentY += 20;

        const tableLeft = leftMargin;
        const colWidths = [400, 115];
        const rowHeight = 30;

        // Category table header
        doc.font('Helvetica-Bold')
          .fontSize(11)
          .fillColor('#ffffff')
          .rect(tableLeft, currentY, colWidths[0], rowHeight)
          .fill('#4f46e5')
          .rect(tableLeft + colWidths[0], currentY, colWidths[1], rowHeight)
          .fill('#4f46e5');

        doc.fillColor('#ffffff')
          .text('Category', tableLeft + 10, currentY + 8, { width: colWidths[0] - 20, align: 'left' })
          .text('Amount', tableLeft + colWidths[0] + 10, currentY + 8, { align: 'right' });

        doc.rect(tableLeft, currentY, colWidths[0], rowHeight)
          .rect(tableLeft + colWidths[0], currentY, colWidths[1], rowHeight)
          .strokeColor('#d1d5db')
          .stroke();

        currentY += rowHeight;

        // Category table rows
        const categoryKeys = Object.keys(categorySummary);
        categoryKeys.forEach((category, index) => {
          if (currentY + rowHeight > pageHeight - bottomMargin - footerHeight) {
            addNewPage();
            doc.font('Helvetica-Bold')
              .fontSize(11)
              .fillColor('#ffffff')
              .rect(tableLeft, currentY, colWidths[0], rowHeight)
              .fill('#4f46e5')
              .rect(tableLeft + colWidths[0], currentY, colWidths[1], rowHeight)
              .fill('#4f46e5');

            doc.fillColor('#ffffff')
              .text('Category', tableLeft + 10, currentY + 8, { width: colWidths[0] - 20, align: 'left' })
              .text('Amount', tableLeft + colWidths[0] + 10, currentY + 8, { align: 'right' });

            doc.rect(tableLeft, currentY, colWidths[0], rowHeight)
              .rect(tableLeft + colWidths[0], currentY, colWidths[1], rowHeight)
              .strokeColor('#d1d5db')
              .stroke();

            currentY += rowHeight;
          }

          const amount = categorySummary[category];
          doc.font('Helvetica')
            .fontSize(11)
            .fillColor('#374151')
            .rect(tableLeft, currentY, colWidths[0], rowHeight)
            .fill(index % 2 === 0 ? '#f9fafb' : '#ffffff')
            .rect(tableLeft + colWidths[0], currentY, colWidths[1], rowHeight)
            .fill(index % 2 === 0 ? '#f9fafb' : '#ffffff');

          doc.fillColor('#374151')
            .text(category || 'Uncategorized', tableLeft + 10, currentY + 8, { width: colWidths[0] - 20, align: 'left', ellipsis: true })
            .fillColor(cleanAmount(amount) >= 0 ? '#10b981' : '#ef4444')
            .text(`${cleanAmount(amount).toFixed(2)}`, tableLeft + colWidths[0] + 10, currentY + 8, { width: colWidths[1] - 20, align: 'right' });

          doc.rect(tableLeft, currentY, colWidths[0], rowHeight)
            .rect(tableLeft + colWidths[0], currentY, colWidths[1], rowHeight)
            .strokeColor('#d1d5db')
            .stroke();

          currentY += rowHeight;
        });

        currentY += 20;

        // Transactions section
        if (reportData.transactions.length === 0) {
          if (currentY + 20 > pageHeight - bottomMargin - footerHeight) {
            addNewPage();
          }
          doc.font('Helvetica')
            .fontSize(12)
            .fillColor('#374151')
            .text('No transactions found for the selected period.', leftMargin, currentY);
          currentY += 20;
        } else {
          const txColWidths = [80, 80, 120, 90, 80, 75];
          const txRowHeight = 25;
          const tableLeft = leftMargin;

          if (currentY + 20 + txRowHeight > pageHeight - bottomMargin - footerHeight) {
            addNewPage();
          }

          doc.font('Helvetica-Bold')
            .fontSize(12)
            .fillColor('#1f2937')
            .text('Transactions', leftMargin, currentY);
          currentY += 20;

          const addTxTableHeader = () => {
            doc.font('Helvetica-Bold')
              .fontSize(11)
              .fillColor('#ffffff')
              .rect(tableLeft, currentY, txColWidths[0], txRowHeight)
              .fill('#4f46e5')
              .rect(tableLeft + txColWidths[0], currentY, txColWidths[1], txRowHeight)
              .fill('#4f46e5')
              .rect(tableLeft + txColWidths[0] + txColWidths[1], currentY, txColWidths[2], txRowHeight)
              .fill('#4f46e5')
              .rect(tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2], currentY, txColWidths[3], txRowHeight)
              .fill('#4f46e5')
              .rect(tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3], currentY, txColWidths[4], txRowHeight)
              .fill('#4f46e5')
              .rect(tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3] + txColWidths[4], currentY, txColWidths[5], txRowHeight)
              .fill('#4f46e5');

            doc.fillColor('#ffffff')
              .text('Type', tableLeft + 5, currentY + 8, { width: txColWidths[0] - 10, align: 'center' })
              .text('Date', tableLeft + txColWidths[0] + 5, currentY + 8, { width: txColWidths[1] - 10, align: 'center' })
              .text('Customer', tableLeft + txColWidths[0] + txColWidths[1] + 5, currentY + 8, { width: txColWidths[2] - 10, align: 'center', ellipsis: true })
              .text('Description', tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + 5, currentY + 8, { width: txColWidths[3] - 10, align: 'left', ellipsis: true })
              .text('Category', tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3] + 5, currentY + 8, { width: txColWidths[4] - 10, align: 'center' })
              .text('Amount', tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3] + txColWidths[4] + 5, currentY + 8, { width: txColWidths[5] - 10, align: 'right' });

            doc.rect(tableLeft, currentY, txColWidths[0], txRowHeight)
              .rect(tableLeft + txColWidths[0], currentY, txColWidths[1], txRowHeight)
              .rect(tableLeft + txColWidths[0] + txColWidths[1], currentY, txColWidths[2], txRowHeight)
              .rect(tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2], currentY, txColWidths[3], txRowHeight)
              .rect(tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3], currentY, txColWidths[4], txRowHeight)
              .rect(tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3] + txColWidths[4], currentY, txColWidths[5], txRowHeight)
              .strokeColor('#d1d5db')
              .stroke();
          };

          addTxTableHeader();
          currentY += txRowHeight;

          reportData.transactions.forEach((t, index) => {
            if (currentY + txRowHeight > pageHeight - bottomMargin - footerHeight) {
              addNewPage();
              addTxTableHeader();
              currentY += txRowHeight;
            }

            doc.font('Helvetica')
              .fontSize(11)
              .fillColor('#374151')
              .rect(tableLeft, currentY, txColWidths[0], txRowHeight)
              .fill(index % 2 === 0 ? '#f9fafb' : '#ffffff')
              .rect(tableLeft + txColWidths[0], currentY, txColWidths[1], txRowHeight)
              .fill(index % 2 === 0 ? '#f9fafb' : '#ffffff')
              .rect(tableLeft + txColWidths[0] + txColWidths[1], currentY, txColWidths[2], txRowHeight)
              .fill(index % 2 === 0 ? '#f9fafb' : '#ffffff')
              .rect(tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2], currentY, txColWidths[3], txRowHeight)
              .fill(index % 2 === 0 ? '#f9fafb' : '#ffffff')
              .rect(tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3], currentY, txColWidths[4], txRowHeight)
              .fill(index % 2 === 0 ? '#f9fafb' : '#ffffff')
              .rect(tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3] + txColWidths[4], currentY, txColWidths[5], txRowHeight)
              .fill(index % 2 === 0 ? '#f9fafb' : '#ffffff');

            doc.fillColor('#374151')
              .text(t.transactionType === 'receivable' ? 'Credit' : 'Debit', tableLeft + 5, currentY + 8, { width: txColWidths[0] - 10, align: 'center' })
              .text(t.date ? new Date(t.date).toISOString().split('T')[0] : 'N/A', tableLeft + txColWidths[0] + 5, currentY + 8, { width: txColWidths[1] - 10, align: 'center' })
              .text(t.customerId?.name || 'N/A', tableLeft + txColWidths[0] + txColWidths[1] + 5, currentY + 8, { width: txColWidths[2] - 10, align: 'center', ellipsis: true })
              .text(truncateDescription(t.description), tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + 5, currentY + 8, { width: txColWidths[3] - 10, align: 'left', ellipsis: true })
              .text(truncateDescription(t.category || 'N/A'), tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3] + 5, currentY + 8, { width: txColWidths[4] - 10, align: 'center' })
              .fillColor(t.transactionType === 'receivable' ? '#10b981' : '#ef4444')
              .text(`${cleanAmount(t.totalAmount).toFixed(2)}`, tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3] + txColWidths[4] + 5, currentY + 8, { width: txColWidths[5] - 10, align: 'right' });

            doc.rect(tableLeft, currentY, txColWidths[0], txRowHeight)
              .rect(tableLeft + txColWidths[0], currentY, txColWidths[1], txRowHeight)
              .rect(tableLeft + txColWidths[0] + txColWidths[1], currentY, txColWidths[2], txRowHeight)
              .rect(tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2], currentY, txColWidths[3], txRowHeight)
              .rect(tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3], currentY, txColWidths[4], txRowHeight)
              .rect(tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3] + txColWidths[4], currentY, txColWidths[5], txRowHeight)
              .strokeColor('#d1d5db')
              .stroke();

            currentY += txRowHeight;
          });
        }

        // Add footer to final page
        if (currentY + footerHeight > pageHeight - bottomMargin) {
          addNewPage();
        } else {
          addFooter(doc.bufferedPageRange().count);
        }

        // Finalize document
        doc.end();

        // Get PDF buffer
        const pdfBuffer = await new Promise((resolve, reject) => {
          doc.on('end', () => {
            const buffer = Buffer.concat(buffers);
            resolve(buffer);
          });
          doc.on('error', reject);
        });

        // Verify and clean up pages with pdf-lib
        const pdfLibDoc = await PDFLibDocument.load(pdfBuffer);
        const actualPageCount = pdfLibDoc.getPageCount();

        if (actualPageCount > 1 && currentY <= topMargin + headerHeight + 50) {
          pdfLibDoc.removePage(actualPageCount - 1);
        }

        const fixedPdfBuffer = await pdfLibDoc.save();
        await fs.writeFile(filePath, fixedPdfBuffer);

        try {
          await fs.access(filePath);
        } catch (err) {
          throw new Error('Failed to create PDF file');
        }

        // Upload PDF
        const blob = await put(`reports/${filename}`, fixedPdfBuffer, {
          access: 'public',
          addRandomSuffix: true,
          token: process.env.BLOB_READ_WRITE_TOKEN,
        });

        await fs.unlink(filePath).catch((err) => console.error('Error deleting temp file:', err));

        res.json({ url: blob.url });
      } catch (pdfError) {
        console.error('PDF Generation Error:', pdfError);
        if (filePath) {
          await fs.unlink(filePath).catch((cleanupError) => {
            console.error('Error cleaning up PDF temp file:', cleanupError);
          });
        }
        throw new Error('Failed to generate PDF');
      }
    } else if (format === 'excel') {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'YourApp';
      workbook.created = new Date();
      const worksheet = workbook.addWorksheet('Financial Report', {
        properties: { tabColor: { argb: 'FF4F46E5' } },
        pageSetup: { fitToPage: true, fitToWidth: 1, margins: { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75 } },
      });

      const colors = {
        primary: 'FF4F46E5',
        secondary: 'FF1F2937',
        accent: 'FF10B981',
        warning: 'FFEF4444',
        background: 'FFF9FAFB',
        header: 'FFE5E7EB',
        text: 'FF374151',
      };

      const applyBorders = (startRow, endRow, cols = ['A', 'B', 'C', 'D', 'E', 'F']) => {
        for (let i = startRow; i <= endRow; i++) {
          cols.forEach((col) => {
            const cell = worksheet.getCell(`${col}${i}`);
            cell.border = {
              top: { style: 'thin', color: { argb: colors.header } },
              left: { style: 'thin', color: { argb: colors.header } },
              bottom: { style: 'thin', color: { argb: colors.header } },
              right: { style: 'thin', color: { argb: colors.header } },
            };
          });
        }
      };

      worksheet.mergeCells('C1:F1');
      worksheet.getCell('C1').value = `${shopName}\nFinancial Summary Report`;
      worksheet.getCell('C1').font = { name: 'Calibri', size: 18, bold: true, color: { argb: colors.secondary } };
      worksheet.getCell('C1').alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      worksheet.getCell('C1').fill = {
        type: 'gradient',
        gradient: 'angle',
        degree: 90,
        stops: [
          { position: 0, color: { argb: colors.background } },
          { position: 1, color: { argb: colors.header } },
        ],
      };
      worksheet.getRow(1).height = 80;
      applyBorders(1, 1, ['C', 'D', 'E', 'F']);

      worksheet.mergeCells('C2:F2');
      worksheet.getCell('C2').value = `Generated on: ${new Date().toLocaleDateString('en-US', { dateStyle: 'medium', timeZone: 'Asia/Karachi' })}`;
      worksheet.getCell('C2').font = { name: 'Calibri', size: 11, italic: true, color: { argb: colors.text } };
      worksheet.getCell('C2').alignment = { horizontal: 'center', vertical: 'middle' };
      worksheet.getCell('C2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.background } };
      worksheet.getRow(2).height = 25;
      applyBorders(2, 2, ['C', 'D', 'E', 'F']);

      if (customerId && transactions[0]?.customerId?.name) {
        worksheet.mergeCells('C3:F3');
        worksheet.getCell('C3').value = `Customer: ${transactions[0].customerId.name}`;
        worksheet.getCell('C3').font = { name: 'Calibri', size: 11, italic: true, color: { argb: colors.text } };
        worksheet.getCell('C3').alignment = { horizontal: 'center', vertical: 'middle' };
        worksheet.getCell('C3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.background } };
        worksheet.getRow(3).height = 25;
        applyBorders(3, 3, ['C', 'D', 'E', 'F']);
      } else if (isAdmin) {
        worksheet.mergeCells('C3:F3');
        worksheet.getCell('C3').value = isAllShops ? 'All Shops' : 'Shop Report';
        worksheet.getCell('C3').font = { name: 'Calibri', size: 11, italic: true, color: { argb: colors.text } };
        worksheet.getCell('C3').alignment = { horizontal: 'center', vertical: 'middle' };
        worksheet.getCell('C3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.background } };
        worksheet.getRow(3).height = 25;
        applyBorders(3, 3, ['C', 'D', 'E', 'F']);
      }

      worksheet.getRow(4).height = 15;

      worksheet.mergeCells('A5:F5');
      worksheet.getCell('A5').value = 'Summary';
      worksheet.getCell('A5').font = { name: 'Calibri', size: 14, bold: true, color: { argb: colors.secondary } };
      worksheet.getCell('A5').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.header } };
      worksheet.getCell('A5').alignment = { horizontal: 'center', vertical: 'middle' };
      worksheet.getRow(5).height = 30;

      const summaryRows = [
        ['Period', `${startDate ? new Date(startDate).toLocaleDateString('en-US', { dateStyle: 'medium' }) : 'N/A'} to ${endDate ? new Date(endDate).toLocaleDateString('en-US', { dateStyle: 'medium' }) : 'N/A'}`],
        ['Opening Balance', cleanAmount(openingBalance).toLocaleString('en-US', { style: 'currency', currency: 'USD' })],
        ['Total Receivables', cleanAmount(totalReceivables).toLocaleString('en-US', { style: 'currency', currency: 'USD' })],
        ['Total Payables', cleanAmount(totalPayables).toLocaleString('en-US', { style: 'currency', currency: 'USD' })],
        ['Closing Balance', cleanAmount(reportData.balance).toLocaleString('en-US', { style: 'currency', currency: 'USD' })],
      ];

      let rowIndex = 6;
      summaryRows.forEach(([label, value], index) => {
        const row = worksheet.addRow([label, value, '', '', '', '']);
        row.font = {
          name: 'Calibri',
          size: 11,
          bold: index === 4,
          color: { argb: index === 2 ? colors.accent : index === 3 ? colors.warning : index === 4 ? (reportData.balance >= 0 ? colors.accent : colors.warning) : colors.text },
        };
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index % 2 === 0 ? colors.background : 'FFFFFFFF' } };
        row.getCell(2).alignment = { horizontal: 'right', vertical: 'middle' };
        row.height = 25;
        applyBorders(rowIndex, rowIndex, ['A', 'B']);
        rowIndex++;
      });

      worksheet.getRow(rowIndex).height = 15;
      rowIndex++;

      worksheet.mergeCells(`A${rowIndex}:B${rowIndex}`);
      worksheet.getCell(`A${rowIndex}`).value = 'Category Summary';
      worksheet.getCell(`A${rowIndex}`).font = { name: 'Calibri', size: 14, bold: true, color: { argb: colors.secondary } };
      worksheet.getCell(`A${rowIndex}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.header } };
      worksheet.getCell(`A${rowIndex}`).alignment = { horizontal: 'center', vertical: 'middle' };
      worksheet.getRow(rowIndex).height = 30;
      applyBorders(rowIndex, rowIndex, ['A', 'B']);
      rowIndex++;

      const catHeaderRow = worksheet.addRow(['Category', 'Amount']);
      catHeaderRow.eachCell((cell, colNumber) => {
        if (colNumber <= 2) {
          cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.primary } };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.border = {
            top: { style: 'thin', color: { argb: colors.header } },
            left: { style: 'thin', color: { argb: colors.header } },
            bottom: { style: 'thin', color: { argb: colors.header } },
            right: { style: 'thin', color: { argb: colors.header } },
          };
        }
      });
      worksheet.getRow(rowIndex).height = 25;
      rowIndex++;

      Object.entries(categorySummary).forEach(([category, amount], index) => {
        const row = worksheet.addRow([category || 'Uncategorized', cleanAmount(amount).toLocaleString('en-US', { style: 'currency', currency: 'USD' })]);
        row.eachCell((cell, colNumber) => {
          if (colNumber <= 2) {
            cell.font = { name: 'Calibri', size: 11, color: { argb: colors.text } };
            if (colNumber === 2) {
              cell.font = { name: 'Calibri', size: 11, color: { argb: cleanAmount(amount) >= 0 ? colors.accent : colors.warning } };
              cell.alignment = { horizontal: 'right', vertical: 'middle' };
            } else {
              cell.alignment = { horizontal: 'left', vertical: 'middle' };
            }
            cell.border = {
              top: { style: 'thin', color: { argb: colors.header } },
              left: { style: 'thin', color: { argb: colors.header } },
              bottom: { style: 'thin', color: { argb: colors.header } },
              right: { style: 'thin', color: { argb: colors.header } },
            };
          }
        });
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index % 2 === 0 ? colors.background : 'FFFFFFFF' } };
        row.height = 25;
        rowIndex++;
      });

      worksheet.getRow(rowIndex).height = 15;
      rowIndex++;

      worksheet.mergeCells(`A${rowIndex}:F${rowIndex}`);
      worksheet.getCell(`A${rowIndex}`).value = 'Transactions';
      worksheet.getCell(`A${rowIndex}`).font = { name: 'Calibri', size: 14, bold: true, color: { argb: colors.secondary } };
      worksheet.getCell(`A${rowIndex}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.header } };
      worksheet.getCell(`A${rowIndex}`).alignment = { horizontal: 'center', vertical: 'middle' };
      worksheet.getRow(rowIndex).height = 30;
      rowIndex++;

      const txHeaderRow = worksheet.addRow(['Type', 'Date', 'Customer', 'Description', 'Category', 'Amount']);
      txHeaderRow.eachCell((cell) => {
        cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.primary } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = {
          top: { style: 'thin', color: { argb: colors.header } },
          left: { style: 'thin', color: { argb: colors.header } },
          bottom: { style: 'thin', color: { argb: colors.header } },
          right: { style: 'thin', color: { argb: colors.header } },
        };
      });
      worksheet.getRow(rowIndex).height = 25;
      applyBorders(rowIndex, rowIndex);
      rowIndex++;

      worksheet.columns = [
        { key: 'type', width: 12 },
        { key: 'date', width: 15 },
        { key: 'customer', width: 20 },
        { key: 'description', width: 35 },
        { key: 'category', width: 15 },
        { key: 'amount', width: 12 },
      ];

      transactions.forEach((t, index) => {
        const row = worksheet.addRow({
          type: t.transactionType === 'receivable' ? 'Credit' : 'Debit',
          date: t.date ? new Date(t.date).toLocaleDateString('en-US', { dateStyle: 'short' }) : 'N/A',
          customer: t.customerId?.name || 'N/A',
          description: truncateDescription(t.description) || 'N/A',
          category: t.category || 'N/A',
          amount: cleanAmount(t.totalAmount).toLocaleString('en-US', { style: 'currency', currency: 'USD' }),
        });
        row.font = { name: 'Calibri', size: 11, color: { argb: colors.text } };
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index % 2 === 0 ? colors.background : 'FFFFFFFF' } };
        row.getCell('amount').font = { name: 'Calibri', size: 11, color: { argb: t.transactionType === 'receivable' ? colors.accent : colors.warning } };
        row.getCell('amount').alignment = { horizontal: 'right', vertical: 'middle' };
        row.getCell('type').alignment = { horizontal: 'center', vertical: 'middle' };
        row.getCell('date').alignment = { horizontal: 'center', vertical: 'middle' };
        row.getCell('customer').alignment = { horizontal: 'center', vertical: 'middle' };
        row.getCell('category').alignment = { horizontal: 'center', vertical: 'middle' };
        row.height = 25;
        applyBorders(rowIndex, rowIndex);
        rowIndex++;
      });

      worksheet.addConditionalFormatting({
        ref: `F${rowIndex - transactions.length}:${rowIndex - 1}`,
        rules: [
          {
            type: 'cellIs',
            operator: 'greaterThanOrEqual',
            formulae: ['0'],
            style: { font: { color: { argb: colors.accent } } },
          },
          {
            type: 'cellIs',
            operator: 'lessThan',
            formulae: ['0'],
            style: { font: { color: { argb: colors.warning } } },
          },
        ],
      });

      worksheet.columns.forEach((column) => {
        let maxLength = 0;
        column.eachCell({ includeEmpty: true }, (cell) => {
          const length = cell.value ? cell.value.toString().length : 0;
          if (length > maxLength) maxLength = length;
        });
        column.width = Math.min(Math.max(column.width || 10, maxLength + 4), 50);
      });

      const filename = `report-${Date.now()}.xlsx`;
      const filePath = path.join(os.tmpdir(), filename);
      await workbook.xlsx.writeFile(filePath);

      try {
        await fs.access(filePath);
      } catch (err) {
        console.error('File does not exist:', filePath);
        throw new Error('Failed to create Excel file');
      }

      const excelBuffer = await fs.readFile(filePath);
      const blob = await put(`reports/${filename}`, excelBuffer, {
        access: 'public',
        addRandomSuffix: true,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });

      await fs.unlink(filePath).catch((err) => console.error('Error deleting temp file:', err));

      res.json({ url: blob.url });
    } else {
      res.json(reportData);
    }
  } catch (error) {
    console.error(`Error in getSummaryReport: ${error.message}`);
    res.status(500).json({ error: `Failed to generate report: ${error.message}` });
  }
};