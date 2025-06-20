const Receipt = require('../models/Receipt');
const Payment = require('../models/Payment');
const PDFKit = require('pdfkit');
const ExcelJS = require('exceljs');
const fs = require('fs').promises;
const { createWriteStream } = require('fs');
const path = require('path');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../Uploads');
const ensureUploadsDir = async () => {
  try {
    await fs.mkdir(uploadsDir, { recursive: true });
    console.log('Uploads directory ensured:', uploadsDir);
  } catch (error) {
    console.error('Error creating uploads directory:', error);
    throw new Error('Failed to create uploads directory');
  }
};

exports.getSummaryReport = async (req, res) => {
  try {
    const { startDate, endDate, format } = req.query;
    const query = { user: req.user.userId };

    // Validate dates
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      if (isNaN(start) || isNaN(end)) {
        return res.status(400).json({ error: 'Invalid date format' });
      }
      query.date = { $gte: start, $lte: end };
    }

    // Fetch data
    const [receipts, payments] = await Promise.all([
      Receipt.find(query),
      Payment.find(query),
    ]);

    const totalReceipts = receipts.reduce((sum, r) => sum + (r.amount || 0), 0);
    const totalPayments = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

    const categorySummary = {};
    receipts.forEach((r) => {
      categorySummary[r.category] = (categorySummary[r.category] || 0) + (r.amount || 0);
    });
    payments.forEach((p) => {
      categorySummary[p.category] = (categorySummary[p.category] || 0) - (p.amount || 0);
    });

    const reportData = {
      totalReceipts,
      totalPayments,
      balance: totalReceipts - totalPayments,
      categorySummary,
      transactions: [...receipts, ...payments].sort((a, b) => new Date(b.date) - new Date(a.date)),
    };

    await ensureUploadsDir();

    if (format === 'pdf') {
      const doc = new PDFKit({ margin: 50 });
      const filename = `report-${Date.now()}.pdf`;
      const filePath = path.join(uploadsDir, filename);
      const writeStream = createWriteStream(filePath);
      doc.pipe(writeStream);

      // Header with logo and title
    //   doc.image('logo.jpg', 50, 30, { width: 100 }).catch(() => {
    //     // Fallback if logo.png is not found
    //     doc.font('Helvetica-Bold').fontSize(20).fillColor('#4f46e5').text('Your Company', 50, 40);
    //   });
      doc
        .font('Helvetica-Bold')
        .fontSize(18)
        .fillColor('#1f2937')
        .text('Financial Summary Report', 0, 40, { align: 'center' });
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#6b7280')
        .text(`Generated on: ${new Date().toLocaleDateString()}`, 0, 60, { align: 'center' });
      doc.moveDown(2);

      // Summary Section
      doc
        .font('Helvetica-Bold')
        .fontSize(14)
        .fillColor('#1f2937')
        .text(`Period: ${startDate || 'N/A'} to ${endDate || 'N/A'}`);
      doc.moveDown(0.5);
      doc
        .font('Helvetica')
        .fontSize(12)
        .fillColor('#374151')
        .text(`Total Receipts: $${totalReceipts.toFixed(2)}`);
      doc.text(`Total Payments: $${totalPayments.toFixed(2)}`);
      doc
        .fillColor(reportData.balance >= 0 ? '#10b981' : '#ef4444')
        .text(`Balance: $${reportData.balance.toFixed(2)}`);
      doc.moveDown(2);

      // Category Summary Table
      doc.font('Helvetica-Bold').fontSize(14).fillColor('#1f2937').text('Category Summary');
      doc.moveDown(0.5);
      const tableTop = doc.y;
      const tableLeft = 50;
      const colWidths = [200, 100];
      let rowIndex = 0;

      // Table Header
      doc
        .font('Helvetica-Bold')
        .fontSize(12)
        .fillColor('#ffffff')
        .rect(tableLeft, tableTop, colWidths[0], 20)
        .fill('#4f46e5');
      doc
        .rect(tableLeft + colWidths[0], tableTop, colWidths[1], 20)
        .fill('#4f46e5');
      doc
        .fillColor('#ffffff')
        .text('Category', tableLeft + 5, tableTop + 5)
        .text('Amount', tableLeft + colWidths[0] + 5, tableTop + 5);
      doc.moveDown(1);

      // Table Rows
      Object.entries(categorySummary).forEach(([category, amount], index) => {
        const y = tableTop + 20 * (index + 1);
        doc
          .font('Helvetica')
          .fontSize(12)
          .fillColor('#374151')
          .rect(tableLeft, y, colWidths[0], 20)
          .fill(index % 2 === 0 ? '#f3f4f6' : '#ffffff')
          .rect(tableLeft + colWidths[0], y, colWidths[1], 20)
          .fill(index % 2 === 0 ? '#f3f4f6' : '#ffffff');
        doc
          .fillColor('#374151')
          .text(category, tableLeft + 5, y + 5)
          .text(`$${amount.toFixed(2)}`, tableLeft + colWidths[0] + 5, y + 5);
        rowIndex = index + 1;
      });

      // Transactions Table
      if (reportData.transactions.length > 0) {
        doc.moveDown(2);
        doc.font('Helvetica-Bold').fontSize(14).fillColor('#1f2937').text('Transactions');
        doc.moveDown(0.5);
        const txTableTop = doc.y;
        const txColWidths = [100, 100, 150, 100, 80];

        // Table Header
        doc
          .font('Helvetica-Bold')
          .fontSize(12)
          .fillColor('#ffffff')
          .rect(tableLeft, txTableTop, txColWidths[0], 20)
          .fill('#4f46e5')
          .rect(tableLeft + txColWidths[0], txTableTop, txColWidths[1], 20)
          .fill('#4f46e5')
          .rect(tableLeft + txColWidths[0] + txColWidths[1], txTableTop, txColWidths[2], 20)
          .fill('#4f46e5')
          .rect(tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2], txTableTop, txColWidths[3], 20)
          .fill('#4f46e5')
          .rect(tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3], txTableTop, txColWidths[4], 20)
          .fill('#4f46e5');
        doc
          .fillColor('#ffffff')
          .text('Type', tableLeft + 5, txTableTop + 5)
          .text('Date', tableLeft + txColWidths[0] + 5, txTableTop + 5)
          .text('Description', tableLeft + txColWidths[0] + txColWidths[1] + 5, txTableTop + 5)
          .text('Category', tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + 5, txTableTop + 5)
          .text('Amount', tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3] + 5, txTableTop + 5);

        // Table Rows
        reportData.transactions.forEach((t, index) => {
          const y = txTableTop + 20 * (index + 1);
          doc
            .font('Helvetica')
            .fontSize(12)
            .fillColor('#374151')
            .rect(tableLeft, y, txColWidths[0], 20)
            .fill(index % 2 === 0 ? '#f3f4f6' : '#ffffff')
            .rect(tableLeft + txColWidths[0], y, txColWidths[1], 20)
            .fill(index % 2 === 0 ? '#f3f4f6' : '#ffffff')
            .rect(tableLeft + txColWidths[0] + txColWidths[1], y, txColWidths[2], 20)
            .fill(index % 2 === 0 ? '#f3f4f6' : '#ffffff')
            .rect(tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2], y, txColWidths[3], 20)
            .fill(index % 2 === 0 ? '#f3f4f6' : '#ffffff')
            .rect(tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3], y, txColWidths[4], 20)
            .fill(index % 2 === 0 ? '#f3f4f6' : '#ffffff');
          doc
            .fillColor('#374151')
            .text(t instanceof Receipt ? 'Receipt' : 'Payment', tableLeft + 5, y + 5)
            .text(t.date ? t.date.toISOString().split('T')[0] : 'N/A', tableLeft + txColWidths[0] + 5, y + 5)
            .text(t.description || 'N/A', tableLeft + txColWidths[0] + txColWidths[1] + 5, y + 5, { width: txColWidths[2] - 10, ellipsis: true })
            .text(t.category || 'N/A', tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + 5, y + 5)
            .text(`$${t.amount?.toFixed(2) || '0.00'}`, tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3] + 5, y + 5);
        });
      }

      // Footer
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#6b7280')
        .text('Generated by YourApp', 50, doc.page.height - 50, { align: 'center' });

      doc.end();

      await new Promise((resolve, reject) => {
        writeStream.on('finish', () => {
          console.log(`PDF generated: ${filePath}`);
          resolve();
        });
        writeStream.on('error', (err) => {
          console.error(`PDF write stream error: ${err.message}`);
          reject(err);
        });
      });

      res.json({ url: `/Uploads/${filename}` });
    } else if (format === 'excel') {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'YourApp';
      workbook.created = new Date();
      const worksheet = workbook.addWorksheet('Financial Report', {
        properties: { tabColor: { argb: 'FF4F46E5' } },
      });

      // Summary Section
      worksheet.addRow(['Financial Summary Report']).font = { size: 16, bold: true, color: { argb: 'FF1F2937' } };
      worksheet.addRow([]);
      worksheet.addRow(['Period', `${startDate || 'N/A'} to ${endDate || 'N/A'}`]);
      worksheet.addRow(['Total Receipts', `$${totalReceipts.toFixed(2)}`]).font = { color: { argb: 'FF10B981' } };
      worksheet.addRow(['Total Payments', `$${totalPayments.toFixed(2)}`]).font = { color: { argb: 'FFEF4444' } };
      worksheet.addRow(['Balance', `$${reportData.balance.toFixed(2)}`]).font = {
        color: { argb: reportData.balance >= 0 ? 'FF10B981' : 'FFEF4444' },
        bold: true,
      };
      worksheet.addRow([]);

      // Category Summary Table
      worksheet.addRow(['Category Summary']).font = { size: 14, bold: true, color: { argb: 'FF1F2937' } };
      worksheet.addRow(['Category', 'Amount']).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      worksheet.getRow(worksheet.rowCount).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4F46E5' },
      };
      Object.entries(categorySummary).forEach(([category, amount], index) => {
        worksheet.addRow([category, `$${amount.toFixed(2)}`]).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: index % 2 === 0 ? 'FFF3F4F6' : 'FFFFFFFF' },
        };
        worksheet.getCell(`B${worksheet.rowCount}`).font = {
          color: { argb: amount >= 0 ? 'FF10B981' : 'FFEF4444' },
        };
      });
      worksheet.addRow([]);

      // Transactions Table
      worksheet.addRow(['Transactions']).font = { size: 14, bold: true, color: { argb: 'FF1F2937' } };
      worksheet.columns = [
        { header: 'Type', key: 'type', width: 10 },
        { header: 'Date', key: 'date', width: 15 },
        { header: 'Description', key: 'description', width: 30 },
        { header: 'Category', key: 'category', width: 15 },
        { header: 'Amount', key: 'amount', width: 10 },
      ];
      worksheet.getRow(worksheet.rowCount).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      worksheet.getRow(worksheet.rowCount).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4F46E5' },
      };

      reportData.transactions.forEach((t, index) => {
        const row = worksheet.addRow({
          type: t instanceof Receipt ? 'Receipt' : 'Payment',
          date: t.date ? t.date.toISOString().split('T')[0] : 'N/A',
          description: t.description || 'N/A',
          category: t.category || 'N/A',
          amount: t.amount ? `$${t.amount.toFixed(2)}` : '$0.00',
        });
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: index % 2 === 0 ? 'FFF3F4F6' : 'FFFFFFFF' },
        };
        row.getCell('amount').font = {
          color: { argb: t instanceof Receipt ? 'FF10B981' : 'FFEF4444' },
        };
      });

      // Auto-fit columns
      worksheet.columns.forEach((column) => {
        let maxLength = 0;
        column.eachCell({ includeEmpty: true }, (cell) => {
          const length = cell.value ? cell.value.toString().length : 0;
          if (length > maxLength) maxLength = length;
        });
        column.width = Math.max(column.width || 10, maxLength + 2);
      });

      const filename = `report-${Date.now()}.xlsx`;
      const filePath = path.join(uploadsDir, filename);
      await workbook.xlsx.writeFile(filePath).catch((err) => {
        console.error(`Excel write error: ${err.message}`);
        throw err;
      });
      console.log(`Excel generated: ${filePath}`);

      res.json({ url: `/Uploads/${filename}` });
    } else {
      res.json(reportData);
    }
  } catch (error) {
    console.error(`Error in getSummaryReport: ${error.message}`);
    res.status(500).json({ error: 'Failed to generate report' });
  }
};