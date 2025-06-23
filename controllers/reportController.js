const Receipt = require('../models/Receipt');
const Payment = require('../models/Payment');
const PDFKit = require('pdfkit');
const ExcelJS = require('exceljs');
const { put } = require('@vercel/blob'); // Import Vercel Blob SDK
const fs = require('fs').promises;
const path = require('path');
const { createWriteStream } = require('fs');

// Use /tmp for temporary file storage in Vercel
const uploadsDir = '/tmp'; // Vercel allows writing to /tmp

// Ensure uploads directory exists (only for /tmp in Vercel)
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

    if (format === 'pdf') {
      const doc = new PDFKit({ margin: 40, size: 'A4' });
      const filename = `report-${Date.now()}.pdf`;
      const filePath = path.join(uploadsDir, filename);
      const writeStream = createWriteStream(filePath);
      doc.pipe(writeStream);

      // Header function
      const addHeader = () => {
        try {
          doc.image(path.join(__dirname, '../dcl.png'), 40, 20, { width: 80 });
        } catch {
          doc.font('Helvetica-Bold').fontSize(16).fillColor('#4f46e5').text('Your Company', 40, 25);
        }
        doc
          .font('Helvetica-Bold')
          .fontSize(14)
          .fillColor('#1f2937')
          .text('Financial Summary Report', 200, 25, { align: 'center' });
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor('#6b7280')
          .text('YourApp Financial Services', 200, 40, { align: 'center' })
          .text('123 Business St, City, Country', 200, 48, { align: 'center' });
        doc.moveTo(40, 65).lineTo(555, 65).strokeColor('#e5e7eb').stroke();
      };

      // Footer function
      const addFooter = (pageNumber) => {
        const pageHeight = doc.page.height;
        doc
          .moveTo(40, pageHeight - 50)
          .lineTo(555, pageHeight - 50)
          .strokeColor('#e5e7eb')
          .stroke();
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor('#6b7280')
          .text('YourApp Financial Services', 40, pageHeight - 40, { align: 'left' })
          .text(`Page ${pageNumber}`, 555, pageHeight - 40, { align: 'right' });
      };

      addHeader();

      let currentY = 80;

      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#6b7280')
        .text(`Generated on: ${new Date().toLocaleDateString('en-US', { dateStyle: 'medium' })}`, 40, currentY);

      currentY += 20;
      doc
        .font('Helvetica-Bold')
        .fontSize(12)
        .fillColor('#1f2937')
        .text(
          `Period: ${startDate ? new Date(startDate).toLocaleDateString('en-US') : 'N/A'} to ${
            endDate ? new Date(endDate).toLocaleDateString('en-US') : 'N/A'
          }`,
          40,
          currentY
        );

      currentY += 30;

      doc
        .rect(40, currentY, 515, 90)
        .fillAndStroke('#f9fafb', '#d1d5db');

      doc
        .fillColor('#1f2937')
        .font('Helvetica-Bold')
        .fontSize(12)
        .text('Summary', 50, currentY + 10);

      doc
        .font('Helvetica')
        .fontSize(11)
        .fillColor('#374151')
        .text(`Total Receipts: $${totalReceipts.toFixed(2)}`, 50, currentY + 30)
        .text(`Total Payments: $${totalPayments.toFixed(2)}`, 50, currentY + 45)
        .fillColor(reportData.balance >= 0 ? '#10b981' : '#ef4444')
        .font('Helvetica-Bold')
        .text(`Balance: $${reportData.balance.toFixed(2)}`, 50, currentY + 60);

      currentY += 110;

      doc.font('Helvetica-Bold').fontSize(12).fillColor('#1f2937').text('Category Summary', 40, currentY);
      currentY += 20;

      const tableTop = currentY;
      const tableLeft = 40;
      const colWidths = [350, 165];
      const rowHeight = 25;

      doc
        .font('Helvetica-Bold')
        .fontSize(11)
        .fillColor('#ffffff')
        .rect(tableLeft, tableTop, colWidths[0], rowHeight)
        .fill('#4f46e5')
        .rect(tableLeft + colWidths[0], tableTop, colWidths[1], rowHeight)
        .fill('#4f46e5');

      doc
        .fillColor('#ffffff')
        .text('Category', tableLeft + 10, tableTop + 8)
        .text('Amount', tableLeft + colWidths[0] + 10, tableTop + 8, { align: 'right' });

      doc
        .rect(tableLeft, tableTop, colWidths[0], rowHeight)
        .rect(tableLeft + colWidths[0], tableTop, colWidths[1], rowHeight)
        .strokeColor('#d1d5db')
        .stroke();

      Object.entries(categorySummary).forEach(([category, amount], index) => {
        const y = tableTop + rowHeight * (index + 1);

        if (y + rowHeight > doc.page.height - 100) {
          doc.addPage();
          currentY = 80;
          addHeader();
          addFooter(doc.page.number);
          doc
            .font('Helvetica-Bold')
            .fontSize(11)
            .fillColor('#ffffff')
            .rect(tableLeft, currentY, colWidths[0], rowHeight)
            .fill('#4f46e5')
            .rect(tableLeft + colWidths[0], currentY, colWidths[1], rowHeight)
            .fill('#4f46e5')
            .fillColor('#ffffff')
            .text('Category', tableLeft + 10, currentY + 8)
            .text('Amount', tableLeft + colWidths[0] + 10, currentY + 8, { align: 'right' });
          currentY += rowHeight;
        }

        doc
          .font('Helvetica')
          .fontSize(11)
          .fillColor('#374151')
          .rect(tableLeft, y, colWidths[0], rowHeight)
          .fill(index % 2 === 0 ? '#f9fafb' : '#ffffff')
          .rect(tableLeft + colWidths[0], y, colWidths[1], rowHeight)
          .fill(index % 2 === 0 ? '#f9fafb' : '#ffffff');

        doc
          .text(category || 'Uncategorized', tableLeft + 10, y + 8)
          .fillColor(amount >= 0 ? '#10b981' : '#ef4444')
          .text(`$${amount.toFixed(2)}`, tableLeft + colWidths[0] + 10, y + 8, { align: 'right' });

        doc
          .rect(tableLeft, y, colWidths[0], rowHeight)
          .rect(tableLeft + colWidths[0], y, colWidths[1], rowHeight)
          .strokeColor('#d1d5db')
          .stroke();
      });

      currentY = tableTop + rowHeight * (Object.keys(categorySummary).length + 1) + 20;

      if (reportData.transactions.length > 0) {
        if (currentY > doc.page.height - 200) {
          doc.addPage();
          currentY = 80;
          addHeader();
          addFooter(doc.page.number);
        }

        doc.font('Helvetica-Bold').fontSize(12).fillColor('#1f2937').text('Transactions', 40, currentY);
        currentY += 20;

        const txColWidths = [80, 80, 200, 80, 75];
        const txRowHeight = 25;
        let txTableTop = currentY;

        const addTxTableHeader = () => {
          doc
            .font('Helvetica-Bold')
            .fontSize(11)
            .fillColor('#ffffff')
            .rect(tableLeft, txTableTop, txColWidths[0], txRowHeight)
            .fill('#4f46e5')
            .rect(tableLeft + txColWidths[0], txTableTop, txColWidths[1], txRowHeight)
            .fill('#4f46e5')
            .rect(tableLeft + txColWidths[0] + txColWidths[1], txTableTop, txColWidths[2], txRowHeight)
            .fill('#4f46e5')
            .rect(tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2], txTableTop, txColWidths[3], txRowHeight)
            .fill('#4f46e5')
            .rect(tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3], txTableTop, txColWidths[4], txRowHeight)
            .fill('#4f46e5');

          doc
            .fillColor('#ffffff')
            .text('Type', tableLeft + 10, txTableTop + 8, { align: 'center' })
            .text('Date', tableLeft + txColWidths[0] + 10, txTableTop + 8, { align: 'center' })
            .text('Description', tableLeft + txColWidths[0] + txColWidths[1] + 10, txTableTop + 8, { align: 'center' })
            .text('Category', tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + 10, txTableTop + 8, { align: 'center' })
            .text('Amount', tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3] + 10, txTableTop + 8, { align: 'right' });

          doc
            .rect(tableLeft, txTableTop, txColWidths[0], txRowHeight)
            .rect(tableLeft + txColWidths[0], txTableTop, txColWidths[1], txRowHeight)
            .rect(tableLeft + txColWidths[0] + txColWidths[1], txTableTop, txColWidths[2], txRowHeight)
            .rect(tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2], txTableTop, txColWidths[3], txRowHeight)
            .rect(tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3], txTableTop, txColWidths[4], txRowHeight)
            .strokeColor('#d1d5db')
            .stroke();
        };

        addTxTableHeader();
        currentY += txRowHeight;

        reportData.transactions.forEach((t, index) => {
          const y = txTableTop + txRowHeight * (index + 1);

          if (y + txRowHeight > doc.page.height - 100) {
            doc.addPage();
            currentY = 80;
            txTableTop = currentY;
            addHeader();
            addFooter(doc.page.number);
            addTxTableHeader();
            currentY += txRowHeight;
          }

          doc
            .font('Helvetica')
            .fontSize(11)
            .fillColor('#374151')
            .rect(tableLeft, y, txColWidths[0], txRowHeight)
            .fill(index % 2 === 0 ? '#f9fafb' : '#ffffff')
            .rect(tableLeft + txColWidths[0], y, txColWidths[1], txRowHeight)
            .fill(index % 2 === 0 ? '#f9fafb' : '#ffffff')
            .rect(tableLeft + txColWidths[0] + txColWidths[1], y, txColWidths[2], txRowHeight)
            .fill(index % 2 === 0 ? '#f9fafb' : '#ffffff')
            .rect(tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2], y, txColWidths[3], txRowHeight)
            .fill(index % 2 === 0 ? '#f9fafb' : '#ffffff')
            .rect(tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3], y, txColWidths[4], txRowHeight)
            .fill(index % 2 === 0 ? '#f9fafb' : '#ffffff');

          doc
            .fillColor('#374151')
            .text(t instanceof Receipt ? 'Receipt' : 'Payment', tableLeft + 10, y + 8, { align: 'center' })
            .text(t.date ? t.date.toISOString().split('T')[0] : 'N/A', tableLeft + txColWidths[0] + 10, y + 8, { align: 'center' })
            .text(t.description || 'N/A', tableLeft + txColWidths[0] + txColWidths[1] + 10, y + 8, { width: txColWidths[2] - 20, ellipsis: true })
            .text(t.category || 'N/A', tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + 10, y + 8, { align: 'center' })
            .fillColor(t instanceof Receipt ? '#10b981' : '#ef4444')
            .text(`$${t.amount?.toFixed(2) || '0.00'}`, tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3] + 10, y + 8, { align: 'right' });

          doc
            .rect(tableLeft, y, txColWidths[0], txRowHeight)
            .rect(tableLeft + txColWidths[0], y, txColWidths[1], txRowHeight)
            .rect(tableLeft + txColWidths[0] + txColWidths[1], y, txColWidths[2], txRowHeight)
            .rect(tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2], y, txColWidths[3], txRowHeight)
            .rect(tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3], y, txColWidths[4], txRowHeight)
            .strokeColor('#d1d5db')
            .stroke();
        });
      }

      doc.end();

      // Wait for PDF to finish writing
      await new Promise((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });

      // Read the PDF file and upload to Vercel Blob
      const pdfBuffer = await fs.readFile(filePath);
      const blob = await put(`reports/${filename}`, pdfBuffer, {
        access: 'public',
        addRandomSuffix: true,
      });

      // Clean up temporary file
      await fs.unlink(filePath).catch((err) => console.error('Error deleting temp file:', err));

      res.json({ url: blob.url });
    } else if (format === 'excel') {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'YourApp';
      workbook.created = new Date();
      const worksheet = workbook.addWorksheet('Financial Report', {
        properties: { tabColor: { argb: 'FF4F46E5' } },
        pageSetup: { fitToPage: true, fitToWidth: 1, margins: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75 } },
      });

      // Header
      try {
        const logoPath = path.join(__dirname, '../dcl.png');
        const logoBuffer = await fs.readFile(logoPath);
        const logo = workbook.addImage({
          buffer: logoBuffer,
          extension: 'png', // Ensure correct extension
        });
        worksheet.addImage(logo, {
          tl: { col: 0, row: 0 },
          ext: { width: 80, height: 80 },
        });
      } catch {
        worksheet.addRow(['Your Company']).font = { size: 16, bold: true, color: { argb: 'FF4F46E5' } };
        worksheet.mergeCells('A1:E1');
      }

      worksheet.mergeCells('C1:E1');
      worksheet.getCell('C1').value = 'Financial Summary Report';
      worksheet.getCell('C1').font = { size: 16, bold: true, color: { argb: 'FF1F2937' } };
      worksheet.getCell('C1').alignment = { horizontal: 'center', vertical: 'middle' };
      worksheet.mergeCells('C2:E2');
      worksheet.getCell('C2').value = `Generated on: ${new Date().toLocaleDateString('en-US', { dateStyle: 'medium' })}`;
      worksheet.getCell('C2').font = { size: 10, color: { argb: 'FF6B7280' } };
      worksheet.getCell('C2').alignment = { horizontal: 'center', vertical: 'middle' };
      worksheet.addRow([]);
      worksheet.getRow(3).height = 10;

      worksheet.mergeCells('A4:E4');
      worksheet.getCell('A4').value = 'Summary';
      worksheet.getCell('A4').font = { size: 14, bold: true, color: { argb: 'FF1F2937' } };
      worksheet.getCell('A4').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
      worksheet.getCell('A4').alignment = { horizontal: 'center' };
      worksheet.addRow([
        'Period',
        `${startDate ? new Date(startDate).toLocaleDateString('en-US') : 'N/A'} to ${endDate ? new Date(endDate).toLocaleDateString('en-US') : 'N/A'}`,
        '',
        '',
        '',
      ]).font = { size: 11 };
      worksheet.addRow(['Total Receipts', `$${totalReceipts.toFixed(2)}`, '', '', '']).font = { size: 11, color: { argb: 'FF10B981' } };
      worksheet.addRow(['Total Payments', `$${totalPayments.toFixed(2)}`, '', '', '']).font = { size: 11, color: { argb: 'FFEF4444' } };
      worksheet.addRow(['Balance', `$${reportData.balance.toFixed(2)}`, '', '', '']).font = {
        size: 11,
        bold: true,
        color: { argb: reportData.balance >= 0 ? 'FF10B981' : 'FFEF4444' },
      };
      for (let i = 5; i <= 8; i++) {
        worksheet.getRow(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
        worksheet.getRow(i).height = 20;
      }
      worksheet.addRow([]);

      worksheet.mergeCells(`A${worksheet.rowCount}:E${worksheet.rowCount}`);
      worksheet.getCell(`A${worksheet.rowCount}`).value = 'Category Summary';
      worksheet.getCell(`A${worksheet.rowCount}`).font = { size: 14, bold: true, color: { argb: 'FF1F2937' } };
      worksheet.getCell(`A${worksheet.rowCount}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
      worksheet.getCell(`A${worksheet.rowCount}`).alignment = { horizontal: 'center' };
      const catHeaderRow = worksheet.addRow(['Category', 'Amount', '', '', '']);
      catHeaderRow.font = { size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      catHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
      catHeaderRow.alignment = { horizontal: 'center', vertical: 'middle' };
      catHeaderRow.height = 25;
      Object.entries(categorySummary).forEach(([category, amount], index) => {
        const row = worksheet.addRow([category, `$${amount.toFixed(2)}`, '', '', '']);
        row.font = { size: 11 };
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index % 2 === 0 ? 'FFF9FAFB' : 'FFFFFFFF' } };
        row.getCell(2).font = { color: { argb: amount >= 0 ? 'FF10B981' : 'FFEF4444' } };
        row.getCell(2).alignment = { horizontal: 'right', vertical: 'middle' };
        row.height = 20;
      });
      worksheet.addRow([]);

      worksheet.mergeCells(`A${worksheet.rowCount}:E${worksheet.rowCount}`);
      worksheet.getCell(`A${worksheet.rowCount}`).value = 'Transactions';
      worksheet.getCell(`A${worksheet.rowCount}`).font = { size: 14, bold: true, color: { argb: 'FF1F2937' } };
      worksheet.getCell(`A${worksheet.rowCount}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
      worksheet.getCell(`A${worksheet.rowCount}`).alignment = { horizontal: 'center' };
      worksheet.columns = [
        { header: 'Type', key: 'type', width: 12 },
        { header: 'Date', key: 'date', width: 15 },
        { header: 'Description', key: 'description', width: 35 },
        { header: 'Category', key: 'category', width: 15 },
        { header: 'Amount', key: 'amount', width: 12 },
      ];
      const txHeaderRow = worksheet.getRow(worksheet.rowCount);
      txHeaderRow.font = { size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      txHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
      txHeaderRow.alignment = { horizontal: 'center', vertical: 'middle' };
      txHeaderRow.height = 25;
      reportData.transactions.forEach((t, index) => {
        const row = worksheet.addRow({
          type: t instanceof Receipt ? 'Receipt' : 'Payment',
          date: t.date ? t.date.toISOString().split('T')[0] : 'N/A',
          description: t.description || 'N/A',
          category: t.category || 'N/A',
          amount: t.amount ? `$${t.amount.toFixed(2)}` : '$0.00',
        });
        row.font = { size: 11 };
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index % 2 === 0 ? 'FFF9FAFB' : 'FFFFFFFF' } };
        row.getCell('amount').font = { color: { argb: t instanceof Receipt ? 'FF10B981' : 'FFEF4444' } };
        row.getCell('amount').alignment = { horizontal: 'right', vertical: 'middle' };
        row.getCell('type').alignment = { horizontal: 'center', vertical: 'middle' };
        row.getCell('date').alignment = { horizontal: 'center', vertical: 'middle' };
        row.getCell('category').alignment = { horizontal: 'center', vertical: 'middle' };
        row.height = 20;
      });

      worksheet.columns.forEach((column) => {
        let maxLength = 0;
        column.eachCell({ includeEmpty: true }, (cell) => {
          const length = cell.value ? cell.value.toString().length : 0;
          if (length > maxLength) maxLength = length;
        });
        column.width = Math.min(Math.max(column.width || 10, maxLength + 2), 50);
      });

      const addBorders = (startRow, endRow) => {
        for (let i = startRow; i <= endRow; i++) {
          ['A', 'B', 'C', 'D', 'E'].forEach((col) => {
            const cell = worksheet.getCell(`${col}${i}`);
            cell.border = {
              top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
              left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
              bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
              right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
            };
          });
        }
      };
      addBorders(10, 10 + Object.keys(categorySummary).length);
      addBorders(13 + Object.keys(categorySummary).length, 13 + Object.keys(categorySummary).length + reportData.transactions.length);

      const filename = `report-${Date.now()}.xlsx`;
      const filePath = path.join(uploadsDir, filename);
      await workbook.xlsx.writeFile(filePath);

      // Read the Excel file and upload to Vercel Blob
      const excelBuffer = await fs.readFile(filePath);
      const blob = await put(`reports/${filename}`, excelBuffer, {
        access: 'public',
        addRandomSuffix: true,
      });

      // Clean up temporary file
      await fs.unlink(filePath).catch((err) => console.error('Error deleting temp file:', err));

      res.json({ url: blob.url });
    } else {
      res.json(reportData);
    }
  } catch (error) {
    console.error(`Error in getSummaryReport: ${error.message}`);
    res.status(500).json({ error: 'Failed to generate report' });
  }
};