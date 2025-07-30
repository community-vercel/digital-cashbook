// backend/controllers/reportController.js
const Transaction = require('../models/Transaction');
const PDFKit = require('pdfkit');
const ExcelJS = require('exceljs');
const { put } = require('@vercel/blob');
const fs = require('fs').promises;
const path = require('path');
const { createWriteStream } = require('fs');
const os = require('os');
const User = require('../models/User');
const Setting = require('../models/Setting');
const axios = require('axios');

exports.getSummaryReport = async (req, res) => {
  try {
    const { startDate, endDate, format, customerId, role } = req.query;
    const settings = await Setting.findOne();
    if (!settings) {
      return res.status(404).json({ error: 'Settings not found' });
    }
    console.log('Settings:', settings);

    // Check if user is admin
    const user = await User.findById(req.user.id);
    const isAdmin = role === 'admin';

    // Build query
    const query = {};
    if (!isAdmin) {
      query.userId = req.user.id; // Uncommented to restrict non-admin users
    }
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      if (isNaN(start) || isNaN(end)) {
        return res.status(400).json({ error: 'Invalid date format' });
      }
      query.date = { $gte: start, $lte: end };
    }
    if (customerId) {
      query.customerId = customerId;
    }

    const truncateDescription = (description) => {
      if (!description) return 'N/A';
      const words = description.trim().split(/\s+/);
      if (words.length > 10) {
        return words.slice(0, 10).join(' ') + ' ....';
      }
      return description;
    };

    // Fetch transactions
    const transactions = await Transaction.find(query).populate('customerId', 'name').sort({ date: -1 });

    // Validate and clean amounts
    const cleanAmount = (amount) => (typeof amount === 'number' && !isNaN(amount) ? amount : 0);

    // Calculate totals using receivable and payable
    const totalReceivables = transactions
      .filter((t) => t.transactionType === 'receivable')
      .reduce((sum, t) => sum + cleanAmount(t.receivable), 0);
    const totalPayables = transactions
      .filter((t) => t.transactionType === 'payable')
      .reduce((sum, t) => sum + cleanAmount(t.payable), 0);

    // Calculate opening balance
    let openingBalance = 0;
    let openingBalanceQuery = { ...query };
    delete openingBalanceQuery.date;
    if (startDate) {
      openingBalanceQuery.date = { $lt: new Date(startDate) };
    }
    const previousTransactions = await Transaction.find(openingBalanceQuery);
    if (previousTransactions.length > 0) {
      openingBalance = previousTransactions.reduce(
        (sum, t) =>
          t.transactionType === 'receivable'
            ? sum + cleanAmount(t.receivable)
            : sum - cleanAmount(t.payable),
        0
      );
    } else {
      // Use stored opening balance if no prior transactions
      openingBalance = settings.openingBalance !== null ? settings.openingBalance : 0;
    }

    // Category summary
    const categorySummary = {};
    transactions.forEach((t) => {
      const amount =
        t.transactionType === 'receivable' ? cleanAmount(t.receivable) : -cleanAmount(t.payable);
      categorySummary[t.category] = (categorySummary[t.category] || 0) + amount;
    });

    const reportData = {
      totalReceivables,
      totalPayables,
      balance: totalReceivables - totalPayables + openingBalance,
      openingBalance,
      categorySummary,
      transactions: transactions.map((t) => ({
        ...t.toObject(),
        type: t.transactionType,
        remainingAmount:
          t.transactionType === 'receivable'
            ? t.totalAmount - t.receivable
            : t.totalAmount - t.payable,
      })),
    };

    // Ensure temp directory exists
    const tempDir = os.tmpdir();
    await fs.mkdir(tempDir, { recursive: true }).catch((err) => {
      console.error('Error creating temp directory:', err);
    });

    if (format === 'pdf') {
      const PDFDocument = require('pdfkit');
      const { PDFDocument: PDFLibDocument } = require('pdf-lib');
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const filename = `report-${Date.now()}.pdf`;
      const filePath = path.join(os.tmpdir(), filename);

      // Buffer to capture PDF output
      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        console.log(`PDF buffer captured, size: ${Buffer.concat(buffers).length} bytes`);
      });

      try {
        // Fetch logo
        let logoBuffer;
        try {
          const response = await axios.get(settings.logo, { responseType: 'arraybuffer' });
          logoBuffer = Buffer.from(response.data);
        } catch (error) {
          console.error('Error fetching logo image:', error.message);
          logoBuffer = null;
        }

        // Page dimensions
        const pageWidth = 595;
        const pageHeight = doc.page.height;
        const leftMargin = 40;
        const rightMargin = 40;
        const topMargin = 40;
        const bottomMargin = 40;
        const usableWidth = pageWidth - leftMargin - rightMargin;
        const usableHeight = pageHeight - topMargin - bottomMargin;

        // Header function
        const addHeader = () => {
          if (logoBuffer) {
            try {
              const x = 40;
              const y = 4;
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
                .text('Your Company', leftMargin, 25, { width: usableWidth, align: 'center' });
            }
          } else {
            doc.font('Helvetica-Bold')
              .fontSize(16)
              .fillColor('#4f46e5')
              .text('Your Company', leftMargin, 25, { width: usableWidth, align: 'center' });
          }

          doc.font('Helvetica-Bold')
            .fontSize(14)
            .fillColor('#1f2937')
            .text(settings.siteName, leftMargin, 25, { width: usableWidth, align: 'center' });

          if (customerId && transactions[0]?.customerId?.name) {
            doc.font('Helvetica')
              .fontSize(12)
              .fillColor('#374151')
              .text(`Customer: ${transactions[0].customerId.name}`, leftMargin, 45, {
                width: usableWidth,
                align: 'center',
              });
          } else if (isAdmin) {
            doc.font('Helvetica')
              .fontSize(12)
              .fillColor('#374151')
              .text('All Users', leftMargin, 45, { width: usableWidth, align: 'center' });
          }

          doc
            .moveTo(leftMargin, 55)
            .lineTo(pageWidth - rightMargin, 55)
            .strokeColor('#e5e7eb')
            .stroke();
        };

        // Footer function
        const addFooter = (pageNumber) => {
          doc
            .font('Helvetica')
            .fontSize(8)
            .fillColor('#6b7280')
            .text(settings.siteName, leftMargin, pageHeight - 40, { align: 'left' })
            .text(`Page ${pageNumber}`, pageWidth - rightMargin, pageHeight - 40, { align: 'right' });
          doc
            .moveTo(leftMargin, pageHeight - 50)
            .lineTo(pageWidth - rightMargin, pageHeight - 50)
            .strokeColor('#e5e7eb')
            .stroke();
        };

        // Initialize first page
        console.log(`Starting PDF generation, initial page count: ${doc.bufferedPageRange().count}`);
        addHeader();
        let currentY = 70;
        console.log(`Initial page, currentY: ${currentY}, usableHeight: ${usableHeight}`);

        // Report period
        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor('#6b7280')
          .text(`Generated on: ${new Date().toLocaleDateString()}`, leftMargin, currentY);

        currentY += 20;
        doc
          .font('Helvetica-Bold')
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
        doc.rect(leftMargin, currentY, usableWidth, 105).fillAndStroke('#f9fafb', '#d1d5db');
        doc
          .font('Helvetica')
          .fontSize(11)
          .fillColor('#374151')
          .text('Summary', leftMargin + 10, currentY + 10)
          .text(`Opening Balance: ${cleanAmount(openingBalance).toFixed(2)}`, leftMargin + 10, currentY + 30)
          .text(`Total Receivables: ${cleanAmount(totalReceivables).toFixed(2)}`, leftMargin + 10, currentY + 45)
          .text(`Total Payables: ${cleanAmount(totalPayables).toFixed(2)}`, leftMargin + 10, currentY + 60)
          .fillColor(reportData.balance >= 0 ? '#10b981' : '#ef4444')
          .text(`Closing Balance: ${cleanAmount(reportData.balance).toFixed(2)}`, leftMargin + 10, currentY + 75);

        currentY += 125;
        console.log(`After summary box, currentY: ${currentY}`);

        // Category Summary
        doc
          .font('Helvetica-Bold')
          .fontSize(12)
          .fillColor('#1f2937')
          .text('Category Summary', leftMargin, currentY);
        currentY += 20;

        const tableTop = currentY;
        const tableLeft = leftMargin;
        const colWidths = [400, 115];
        const rowHeight = 30;

        if (currentY + rowHeight > usableHeight) {
          doc.addPage();
          currentY = topMargin + 30;
          addHeader();
          addFooter(doc.page.number);
          console.log(`New page for category summary, currentY: ${currentY}, page: ${doc.bufferedPageRange().count}`);
        }

        // Category table header
        doc
          .font('Helvetica-Bold')
          .fontSize(11)
          .fillColor('#ffffff')
          .rect(tableLeft, currentY, colWidths[0], rowHeight)
          .fill('#4f46e5')
          .rect(tableLeft + colWidths[0], currentY, colWidths[1], rowHeight)
          .fill('#4f46e5');

        doc
          .fillColor('#ffffff')
          .text('Category', tableLeft + 10, currentY + 8, { width: colWidths[0] - 20, align: 'left' })
          .text('Amount', tableLeft + colWidths[0] + 10, currentY + 8, { align: 'right' });

        doc
          .rect(tableLeft, currentY, colWidths[0], rowHeight)
          .rect(tableLeft + colWidths[0], currentY, colWidths[1], rowHeight)
          .strokeColor('#d1d5db')
          .stroke();

        currentY += rowHeight;

        // Category table rows
        const categoryKeys = Object.keys(categorySummary);
        categoryKeys.forEach((category, index) => {
          const amount = categorySummary[category];
          const y = currentY;

          if (y + rowHeight > usableHeight && index < categoryKeys.length - 1) {
            doc.addPage();
            currentY = topMargin + 30;
            addHeader();
            addFooter(doc.page.number);
            console.log(`New page for category ${category}, currentY: ${currentY}, page: ${doc.bufferedPageRange().count}`);
            doc
              .font('Helvetica-Bold')
              .fontSize(11)
              .fillColor('#ffffff')
              .rect(tableLeft, currentY, colWidths[0], rowHeight)
              .fill('#4f46e5')
              .rect(tableLeft + colWidths[0], currentY, colWidths[1], rowHeight)
              .fill('#4f46e5');

            doc
              .fillColor('#ffffff')
              .text('Category', tableLeft + 10, currentY + 8, { width: colWidths[0] - 20, align: 'left' })
              .text('Amount', tableLeft + colWidths[0] + 10, currentY + 8, { align: 'right' });

            doc
              .rect(tableLeft, currentY, colWidths[0], rowHeight)
              .rect(tableLeft + colWidths[0], currentY, colWidths[1], rowHeight)
              .strokeColor('#d1d5db')
              .stroke();

            currentY += rowHeight;
          }

          doc
            .font('Helvetica')
            .fontSize(11)
            .fillColor('#374151')
            .rect(tableLeft, currentY, colWidths[0], rowHeight)
            .fill(index % 2 === 0 ? '#f9fafb' : '#ffffff')
            .rect(tableLeft + colWidths[0], currentY, colWidths[1], rowHeight)
            .fill(index % 2 === 0 ? '#f9fafb' : '#ffffff');

          doc
            .fillColor('#374151')
            .text(category || 'Uncategorized', tableLeft + 10, currentY + 8, {
              width: colWidths[0] - 20,
              align: 'left',
              ellipsis: true,
            })
            .fillColor(cleanAmount(amount) >= 0 ? '#10b981' : '#ef4444')
            .text(`${cleanAmount(amount).toFixed(2)}`, tableLeft + colWidths[0] + 10, currentY + 8, {
              width: colWidths[1] - 20,
              align: 'right',
            });

          doc
            .rect(tableLeft, currentY, colWidths[0], rowHeight)
            .rect(tableLeft + colWidths[0], currentY, colWidths[1], rowHeight)
            .strokeColor('#d1d5db')
            .stroke();

          currentY += rowHeight;
        });

        currentY += 20;
        console.log(`After category summary, currentY: ${currentY}`);

        // Transactions section
        if (reportData.transactions.length === 0) {
          if (currentY + 20 > usableHeight) {
            doc.addPage();
            currentY = topMargin + 30;
            addHeader();
            addFooter(doc.page.number);
            console.log(`New page for no transactions message, currentY: ${currentY}, page: ${doc.bufferedPageRange().count}`);
          }
          doc
            .font('Helvetica')
            .fontSize(12)
            .fillColor('#374151')
            .text('No transactions found for the selected period.', leftMargin, currentY);
          currentY += 20;
        } else {
          // Adjusted column widths to fit Total Amount and Remaining Amount
          const txColWidths = [60, 70, 100, 80, 70, 70, 70];
          const txRowHeight = 30;
          const tableLeft = leftMargin;

          if (currentY + 20 + txRowHeight > usableHeight) {
            doc.addPage();
            currentY = topMargin + 30;
            addHeader();
            addFooter(doc.page.number);
            console.log(`New page for transactions, currentY: ${currentY}, page: ${doc.bufferedPageRange().count}`);
          }

          doc
            .font('Helvetica-Bold')
            .fontSize(12)
            .fillColor('#1f2937')
            .text('Transactions', leftMargin, currentY);
          currentY += 20;

          const addTxTableHeader = () => {
            doc
              .font('Helvetica-Bold')
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
              .rect(
                tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3],
                currentY,
                txColWidths[4],
                txRowHeight
              )
              .fill('#4f46e5')
              .rect(
                tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3] + txColWidths[4],
                currentY,
                txColWidths[5],
                txRowHeight
              )
              .fill('#4f46e5')
              .rect(
                tableLeft +
                  txColWidths[0] +
                  txColWidths[1] +
                  txColWidths[2] +
                  txColWidths[3] +
                  txColWidths[4] +
                  txColWidths[5],
                currentY,
                txColWidths[6],
                txRowHeight
              )
              .fill('#4f46e5');

            doc
              .fillColor('#ffffff')
              .text('Type', tableLeft + 5, currentY + 8, { width: txColWidths[0] - 10, align: 'center' })
              .text('Date', tableLeft + txColWidths[0] + 5, currentY + 8, {
                width: txColWidths[1] - 10,
                align: 'center',
              })
              .text('Customer', tableLeft + txColWidths[0] + txColWidths[1] + 5, currentY + 8, {
                width: txColWidths[2] - 10,
                align: 'center',
                ellipsis: true,
              })
              .text('Description', tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + 5, currentY + 8, {
                width: txColWidths[3] - 10,
                align: 'left',
                ellipsis: true,
              })
              .text(
                'Category',
                tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3] + 5,
                currentY + 8,
                { width: txColWidths[4] - 10, align: 'center' }
              )
              .text(
                'Total Amount',
                tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3] + txColWidths[4] + 5,
                currentY + 8,
                { width: txColWidths[5] - 10, align: 'right' }
              )
              .text(
                'Remaining',
                tableLeft +
                  txColWidths[0] +
                  txColWidths[1] +
                  txColWidths[2] +
                  txColWidths[3] +
                  txColWidths[4] +
                  txColWidths[5] +
                  5,
                currentY + 8,
                { width: txColWidths[6] - 10, align: 'right' }
              );

            doc
              .rect(tableLeft, currentY, txColWidths[0], txRowHeight)
              .rect(tableLeft + txColWidths[0], currentY, txColWidths[1], txRowHeight)
              .rect(tableLeft + txColWidths[0] + txColWidths[1], currentY, txColWidths[2], txRowHeight)
              .rect(tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2], currentY, txColWidths[3], txRowHeight)
              .rect(
                tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3],
                currentY,
                txColWidths[4],
                txRowHeight
              )
              .rect(
                tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3] + txColWidths[4],
                currentY,
                txColWidths[5],
                txRowHeight
              )
              .rect(
                tableLeft +
                  txColWidths[0] +
                  txColWidths[1] +
                  txColWidths[2] +
                  txColWidths[3] +
                  txColWidths[4] +
                  txColWidths[5],
                currentY,
                txColWidths[6],
                txRowHeight
              )
              .strokeColor('#d1d5db')
              .stroke();
          };

          addTxTableHeader();
          currentY += txRowHeight;

          reportData.transactions.forEach((t, index) => {
            const y = currentY;
            console.log(`Transaction ${index + 1} - y: ${y}, usableHeight: ${usableHeight}`);

            if (y + txRowHeight > usableHeight && index < reportData.transactions.length - 1) {
              doc.addPage();
              currentY = topMargin + 30;
              addHeader();
              addFooter(doc.page.number);
              addTxTableHeader();
              currentY += txRowHeight;
              console.log(
                `New page for transaction ${index + 1}, currentY: ${currentY}, page: ${doc.bufferedPageRange().count}`
              );
            }

            doc
              .font('Helvetica')
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
              .rect(
                tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3],
                currentY,
                txColWidths[4],
                txRowHeight
              )
              .fill(index % 2 === 0 ? '#f9fafb' : '#ffffff')
              .rect(
                tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3] + txColWidths[4],
                currentY,
                txColWidths[5],
                txRowHeight
              )
              .fill(index % 2 === 0 ? '#f9fafb' : '#ffffff')
              .rect(
                tableLeft +
                  txColWidths[0] +
                  txColWidths[1] +
                  txColWidths[2] +
                  txColWidths[3] +
                  txColWidths[4] +
                  txColWidths[5],
                currentY,
                txColWidths[6],
                txRowHeight
              )
              .fill(index % 2 === 0 ? '#f9fafb' : '#ffffff');

            doc
              .fillColor('#374151')
              .text(t.transactionType === 'receivable' ? 'Credit' : 'Debit', tableLeft + 5, currentY + 8, {
                width: txColWidths[0] - 10,
                align: 'center',
              })
              .text(
                t.date ? new Date(t.date).toISOString().split('T')[0] : 'N/A',
                tableLeft + txColWidths[0] + 5,
                currentY + 8,
                { width: txColWidths[1] - 10, align: 'center' }
              )
              .text(
                t.customerId?.name || 'N/A',
                tableLeft + txColWidths[0] + txColWidths[1] + 5,
                currentY + 8,
                { width: txColWidths[2] - 10, align: 'center', ellipsis: true }
              )
              .text(
                truncateDescription(t.description),
                tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + 5,
                currentY + 8,
                { width: txColWidths[3] - 10, align: 'left', ellipsis: true }
              )
              .text(
                truncateDescription(t.category || 'N/A'),
                tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3] + 5,
                currentY + 8,
                { width: txColWidths[4] - 10, align: 'center' }
              )
              .fillColor(t.transactionType === 'receivable' ? '#10b981' : '#ef4444')
              .text(
                `${cleanAmount(t.totalAmount).toFixed(2)}`,
                tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3] + txColWidths[4] + 5,
                currentY + 8,
                { width: txColWidths[5] - 10, align: 'right' }
              )
              .text(
                `${cleanAmount(t.remainingAmount).toFixed(2)}`,
                tableLeft +
                  txColWidths[0] +
                  txColWidths[1] +
                  txColWidths[2] +
                  txColWidths[3] +
                  txColWidths[4] +
                  txColWidths[5] +
                  5,
                currentY + 8,
                { width: txColWidths[6] - 10, align: 'right' }
              );

            doc
              .rect(tableLeft, currentY, txColWidths[0], txRowHeight)
              .rect(tableLeft + txColWidths[0], currentY, txColWidths[1], txRowHeight)
              .rect(tableLeft + txColWidths[0] + txColWidths[1], currentY, txColWidths[2], txRowHeight)
              .rect(tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2], currentY, txColWidths[3], txRowHeight)
              .rect(
                tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3],
                currentY,
                txColWidths[4],
                txRowHeight
              )
              .rect(
                tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3] + txColWidths[4],
                currentY,
                txColWidths[5],
                txRowHeight
              )
              .rect(
                tableLeft +
                  txColWidths[0] +
                  txColWidths[1] +
                  txColWidths[2] +
                  txColWidths[3] +
                  txColWidths[4] +
                  txColWidths[5],
                currentY,
                txColWidths[6],
                txRowHeight
              )
              .strokeColor('#d1d5db')
              .stroke();

            currentY += txRowHeight;
          });
        }

        // Add footer to final page
        if (currentY + 50 > usableHeight) {
          doc.addPage();
          currentY = topMargin + 30;
          addHeader();
          console.log(`New page for final footer, currentY: ${currentY}, page: ${doc.bufferedPageRange().count}`);
        }
        addFooter(doc.page.number);
        console.log(`After footer, currentY: ${currentY}, page count before end: ${doc.bufferedPageRange().count}`);

        // Explicitly flush pages
        doc.flushPages();
        console.log(`After flushPages, page count: ${doc.bufferedPageRange().count}`);

        // Finalize document
        doc.end();
        console.log(`Document ended, page count: ${doc.bufferedPageRange().count}`);

        // Get PDF buffer
        const pdfBuffer = await new Promise((resolve, reject) => {
          doc.on('end', () => {
            const buffer = Buffer.concat(buffers);
            console.log(
              `PDF stream finished, final page count: ${doc.bufferedPageRange().count}, buffer size: ${buffer.length} bytes`
            );
            resolve(buffer);
          });
          doc.on('error', (err) => {
            console.error('Error in PDF stream:', err);
            reject(err);
          });
        });

        // Post-process with pdf-lib to verify and fix page count
        const pdfLibDoc = await PDFLibDocument.load(pdfBuffer);
        const actualPageCount = pdfLibDoc.getPageCount();
        console.log(`pdf-lib page count: ${actualPageCount}`);

        // Remove extra pages if necessary
        if (actualPageCount > 1) {
          console.log(`Detected ${actualPageCount} pages, removing extra pages`);
          while (pdfLibDoc.getPageCount() > 1) {
            pdfLibDoc.removePage(pdfLibDoc.getPageCount() - 1);
          }
          console.log(`After removing extra pages, pdf-lib page count: ${pdfLibDoc.getPageCount()}`);
        }

        // Save fixed PDF buffer
        const fixedPdfBuffer = await pdfLibDoc.save();
        console.log(`Fixed PDF buffer size: ${fixedPdfBuffer.length} bytes`);

        // Write fixed PDF to file
        await fs.writeFile(filePath, fixedPdfBuffer);
        console.log(`PDF file written directly: ${filePath}`);

        // Save a local copy for debugging
        console.log('Local PDF saved as test-output.pdf for debugging');

        try {
          await fs.access(filePath);
          console.log(`PDF file created successfully: ${filePath}`);
        } catch (err) {
          console.error('File does not exist:', filePath);
          throw new Error('Failed to create PDF file');
        }

        // Upload fixed PDF
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

      const applyBorders = (startRow, endRow, cols = ['A', 'B', 'C', 'D', 'E', 'F', 'G']) => {
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

      worksheet.mergeCells('C1:G1');
      worksheet.getCell('C1').value = `${settings.siteName || 'Your Company'}\nFinancial Summary Report`;
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
      applyBorders(1, 1, ['C', 'D', 'E', 'F', 'G']);

      worksheet.mergeCells('C2:G2');
      worksheet.getCell('C2').value = `Generated on: ${new Date().toLocaleDateString('en-US', {
        dateStyle: 'medium',
        timeZone: 'Asia/Karachi',
      })}`;
      worksheet.getCell('C2').font = { name: 'Calibri', size: 11, italic: true, color: { argb: colors.text } };
      worksheet.getCell('C2').alignment = { horizontal: 'center', vertical: 'middle' };
      worksheet.getCell('C2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.background } };
      worksheet.getRow(2).height = 25;
      applyBorders(2, 2, ['C', 'D', 'E', 'F', 'G']);

      if (customerId && transactions[0]?.customerId?.name) {
        worksheet.mergeCells('C3:G3');
        worksheet.getCell('C3').value = `Customer: ${transactions[0].customerId.name}`;
        worksheet.getCell('C3').font = { name: 'Calibri', size: 11, italic: true, color: { argb: colors.text } };
        worksheet.getCell('C3').alignment = { horizontal: 'center', vertical: 'middle' };
        worksheet.getCell('C3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.background } };
        worksheet.getRow(3).height = 25;
        applyBorders(3, 3, ['C', 'D', 'E', 'F', 'G']);
      } else if (isAdmin) {
        worksheet.mergeCells('C3:G3');
        worksheet.getCell('C3').value = 'All Users';
        worksheet.getCell('C3').font = { name: 'Calibri', size: 11, italic: true, color: { argb: colors.text } };
        worksheet.getCell('C3').alignment = { horizontal: 'center', vertical: 'middle' };
        worksheet.getCell('C3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.background } };
        worksheet.getRow(3).height = 25;
        applyBorders(3, 3, ['C', 'D', 'E', 'F', 'G']);
      }

      worksheet.getRow(4).height = 15;

      worksheet.mergeCells('A5:G5');
      worksheet.getCell('A5').value = 'Summary';
      worksheet.getCell('A5').font = { name: 'Calibri', size: 14, bold: true, color: { argb: colors.secondary } };
      worksheet.getCell('A5').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.header } };
      worksheet.getCell('A5').alignment = { horizontal: 'center', vertical: 'middle' };
      worksheet.getRow(5).height = 30;

      const summaryRows = [
        [
          'Period',
          `${startDate ? new Date(startDate).toLocaleDateString('en-US', { dateStyle: 'medium' }) : 'N/A'} to ${
            endDate ? new Date(endDate).toLocaleDateString('en-US', { dateStyle: 'medium' }) : 'N/A'
          }`,
        ],
        ['Opening Balance', cleanAmount(openingBalance).toLocaleString('en-US', { style: 'currency', currency: 'PKR' })],
        [
          'Total Receivables',
          cleanAmount(totalReceivables).toLocaleString('en-US', { style: 'currency', currency: 'PKR' }),
        ],
        ['Total Payables', cleanAmount(totalPayables).toLocaleString('en-US', { style: 'currency', currency: 'PKR' })],
        ['Closing Balance', cleanAmount(reportData.balance).toLocaleString('en-US', { style: 'currency', currency: 'PKR' })],
      ];

      let rowIndex = 6;
      summaryRows.forEach(([label, value], index) => {
        const row = worksheet.addRow([label, value, '', '', '', '', '']);
        row.font = {
          name: 'Calibri',
          size: 11,
          bold: index === 4,
          color: {
            argb: index === 2 ? colors.accent : index === 3 ? colors.warning : index === 4 ? (reportData.balance >= 0 ? colors.accent : colors.warning) : colors.text,
          },
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
        const row = worksheet.addRow([
          category || 'Uncategorized',
          cleanAmount(amount).toLocaleString('en-US', { style: 'currency', currency: 'PKR' }),
        ]);
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

      worksheet.mergeCells(`A${rowIndex}:G${rowIndex}`);
      worksheet.getCell(`A${rowIndex}`).value = 'Transactions';
      worksheet.getCell(`A${rowIndex}`).font = { name: 'Calibri', size: 14, bold: true, color: { argb: colors.secondary } };
      worksheet.getCell(`A${rowIndex}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.header } };
      worksheet.getCell(`A${rowIndex}`).alignment = { horizontal: 'center', vertical: 'middle' };
      worksheet.getRow(rowIndex).height = 30;
      rowIndex++;

      const txHeaderRow = worksheet.addRow(['Type', 'Date', 'Customer', 'Description', 'Category', 'Total Amount', 'Remaining']);
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
        { key: 'totalAmount', width: 12 },
        { key: 'remainingAmount', width: 12 },
      ];

      transactions.forEach((t, index) => {
        const row = worksheet.addRow({
          type: t.transactionType === 'receivable' ? 'Credit' : 'Debit',
          date: t.date ? new Date(t.date).toLocaleDateString('en-US', { dateStyle: 'short' }) : 'N/A',
          customer: t.customerId?.name || 'N/A',
          description: truncateDescription(t.description) || 'N/A',
          category: t.category || 'N/A',
          totalAmount: cleanAmount(t.totalAmount).toLocaleString('en-US', { style: 'currency', currency: 'PKR' }),
          remainingAmount: cleanAmount(t.totalAmount - (t.transactionType === 'receivable' ? t.receivable : t.payable)).toLocaleString('en-US', {
            style: 'currency',
            currency: 'PKR',
          }),
        });
        row.font = { name: 'Calibri', size: 11, color: { argb: colors.text } };
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index % 2 === 0 ? colors.background : 'FFFFFFFF' } };
        row.getCell('totalAmount').font = { name: 'Calibri', size: 11, color: { argb: t.transactionType === 'receivable' ? colors.accent : colors.warning } };
        row.getCell('remainingAmount').font = {
          name: 'Calibri',
          size: 11,
          color: { argb: cleanAmount(t.totalAmount - (t.transactionType === 'receivable' ? t.receivable : t.payable)) >= 0 ? colors.accent : colors.warning },
        };
        row.getCell('totalAmount').alignment = { horizontal: 'right', vertical: 'middle' };
        row.getCell('remainingAmount').alignment = { horizontal: 'right', vertical: 'middle' };
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

      worksheet.addConditionalFormatting({
        ref: `G${rowIndex - transactions.length}:${rowIndex - 1}`,
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
      const filePath = path.join(tempDir, filename);
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