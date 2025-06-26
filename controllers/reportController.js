const Receipt = require('../models/Receipt');
const Payment = require('../models/Payment');
const PDFKit = require('pdfkit');
const ExcelJS = require('exceljs');
const { put } = require('@vercel/blob');
const fs = require('fs').promises;
const path = require('path');
const { createWriteStream } = require('fs');
const os = require('os');
const User = require('../models/User');
const Setting = require('../models/Setting'); // Adjust the path if needed
const axios = require('axios');

exports.getSummaryReport = async (req, res) => {
    try {
        const { startDate, endDate, format, customerId, role } = req.query;
        const settings = await Setting.findOne(); // Adjust query if settings are per-user or have multiple entries
        console.log('Settings:', settings);
        // Check if user is admin
        const user = await User.findById(req.user.id);
        const isAdmin = role === 'admin';

        // Build query
        const query = {};
        // if (!isAdmin) {
        //   query.userId = req.user.id; // Restrict to authenticated user for non-admins
        // }
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
            if (words.length > 2) {
                return words.slice(0, 10).join(' ') + ' ....';
            }
            return description;
        };
        // Fetch data
        const [receipts, payments] = await Promise.all([
            Receipt.find(query).populate('customerId', 'name'),
            Payment.find(query).populate('customerId', 'name'),
        ]);

        // Validate and clean amounts
        const cleanAmount = (amount) => (typeof amount === 'number' && !isNaN(amount) ? amount : 0);

        const totalReceipts = receipts.reduce((sum, r) => sum + cleanAmount(r.amount), 0);
        const totalPayments = payments.reduce((sum, p) => sum + cleanAmount(p.amount), 0);

        // Calculate opening balance
        let openingBalanceQuery = { ...query };
        delete openingBalanceQuery.date;
        if (startDate) {
            openingBalanceQuery.date = { $lt: new Date(startDate) };
        }
        const [previousReceipts, previousPayments] = await Promise.all([
            Receipt.find(openingBalanceQuery),
            Payment.find(openingBalanceQuery),
        ]);
        const openingBalance =
            previousReceipts.reduce((sum, r) => sum + cleanAmount(r.amount), 0) -
            previousPayments.reduce((sum, p) => sum + cleanAmount(p.amount), 0);

        const categorySummary = {};
        receipts.forEach((r) => {
            const amount = cleanAmount(r.amount);
            categorySummary[r.category] = (categorySummary[r.category] || 0) + amount;
        });
        payments.forEach((p) => {
            const amount = cleanAmount(p.amount);
            categorySummary[p.category] = (categorySummary[p.category] || 0) - amount;
        });

        const reportData = {
            totalReceipts,
            totalPayments,
            balance: totalReceipts - totalPayments + openingBalance,
            openingBalance,
            categorySummary,
            transactions: [...receipts.map(t => ({ ...t.toObject(), type: 'receipt' })),
            ...payments.map(t => ({ ...t.toObject(), type: 'payment' }))]
                .sort((a, b) => new Date(b.date) - new Date(a.date)),
        };

        // Ensure temp directory exists
        const tempDir = os.tmpdir();
        await fs.mkdir(tempDir, { recursive: true }).catch((err) => {
            console.error('Error creating temp directory:', err);
        });

        if (format === 'pdf') {
            const doc = new PDFKit({ margin: 40, size: 'A4' });
            const filename = `report-${Date.now()}.pdf`;
            const filePath = path.join(tempDir, filename);
            const writeStream = createWriteStream(filePath);
            doc.pipe(writeStream);

            try {

                let logoBuffer;
                try {
                    const response = await axios.get(settings.logo, { responseType: 'arraybuffer' });
                    logoBuffer = Buffer.from(response.data);
                } catch (error) {
                    console.error('Error fetching logo image:', error.message);
                    logoBuffer = null; // Handle fallback in addHeader
                }
                // Header function
                const addHeader = () => {
                    if (logoBuffer) {
                        try {
                            const x = 40;
                            const y = 4;
                            const radius = 25; // Half of width/height
                            const diameter = radius * 2;

                            // Clip to a circular path
                            doc.save(); // Save current graphics state
                            doc.circle(x + radius, y + radius, radius).clip(); // Clip to a circle
                            doc.image(logoBuffer, x, y, { width: diameter, height: diameter }); // Draw image inside the circle
                            doc.restore();
                        } catch (error) {
                            console.error('Error rendering logo image:', error.message);
                            doc.font('Helvetica-Bold').fontSize(16).fillColor('#4f46e5').text('Your Company', 40, 25);
                        }
                    } else {
                        doc.font('Helvetica-Bold').fontSize(16).fillColor('#4f46e5').text('Your Company', 40, 25);
                    }
                    doc
                        .font('Helvetica-Bold')
                        .fontSize(14)
                        .fillColor('#1f2937')
                        .text(settings.siteName, 160, 25, { align: 'center' });

                    if (customerId && receipts[0]?.customerId?.name) {
                        doc.text(`Customer: ${receipts[0].customerId.name}`, 200, 45, { align: 'center' });
                    } else if (isAdmin) {
                        doc.text('All Users', 160, 45, { align: 'center' });
                    }

                    doc.moveTo(40, 55).lineTo(555, 55).strokeColor('#e5e7eb').stroke();
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
                        .text(settings.siteName, 40, pageHeight - 40, { align: 'left' })
                        .text(`Page ${pageNumber}`, 555, pageHeight - 40, { align: 'right' });
                };

                addHeader();
                let currentY = 70;

                // Report period
                doc
                    .font('Helvetica')
                    .fontSize(10)
                    .fillColor('#6b7280')
                    .text(`Generated on: ${new Date().toLocaleDateString()}`, 40, currentY);

                currentY += 20;
                doc
                    .font('Helvetica-Bold')
                    .fontSize(12)
                    .fillColor('#1f2937')
                    .text(
                        `Period: ${startDate ? new Date(startDate).toLocaleDateString() : 'N/A'} to ${endDate ? new Date(endDate).toLocaleDateString() : 'N/A'
                        }`,
                        40,
                        currentY
                    );

                currentY += 30;

                // Summary box
                doc
                    .rect(40, currentY, 515, 105)
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
                    .text(`Opening Balance:  ${cleanAmount(openingBalance).toFixed(2)}`, 50, currentY + 30)
                    .text(`Total Credits:  ${cleanAmount(totalReceipts).toFixed(2)}`, 50, currentY + 45)
                    .text(`Total Debits:  ${cleanAmount(totalPayments).toFixed(2)}`, 50, currentY + 60)
                    .fillColor(reportData.balance >= 0 ? '#10b981' : '#ef4444')
                    .font('Helvetica-Bold')
                    .text(`Closing Balance:  ${cleanAmount(reportData.balance).toFixed(2)}`, 50, currentY + 75);

                currentY += 125;

                // Category Summary
                doc.font('Helvetica-Bold').fontSize(12).fillColor('#1f2937').text('Category Summary', 40, currentY);
                currentY += 20;

                const tableTop = currentY;
                const tableLeft = 40;
                const colWidths = [350, 165];
                const rowHeight = 25;

                // Category table header
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

                // Category table rows
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
                        .fillColor('#374151')
                        .text(category || 'Uncategorized', tableLeft + 10, y + 8)
                        .fillColor(cleanAmount(amount) >= 0 ? '#10b981' : '#ef4444')
                        .text(` ${cleanAmount(amount).toFixed(2)}`, tableLeft + colWidths[0] + 10, y + 8, { align: 'right' });

                    doc
                        .rect(tableLeft, y, colWidths[0], rowHeight)
                        .rect(tableLeft + colWidths[0], y, colWidths[1], rowHeight)
                        .strokeColor('#d1d5db')
                        .stroke();
                });

                currentY = tableTop + rowHeight * (Object.keys(categorySummary).length + 1) + 20;

                // Transactions section
                if (reportData.transactions.length === 0) {
                    doc
                        .font('Helvetica')
                        .fontSize(12)
                        .fillColor('#374151')
                        .text('No transactions found for the selected period.', 40, currentY);
                    currentY += 20;
                } else {
                    // Constants for layout
                    const txColWidths = [80, 80, 120, 90, 80, 75];
                    const txRowHeight = 25;
                    const tableLeft = 40;
                    const pageHeight = doc.page.height;
                    const topMargin = 40; // From doc = new PDFKit({ margin: 40 })
                    const bottomMargin = 60; // Reduced from 80 to allow more content
                    const usableHeight = pageHeight - topMargin - bottomMargin; // ~741 points for A4

                    // Check if there's enough space for the title, table header, and at least one row
                    if (currentY + 20 + txRowHeight + txRowHeight > usableHeight) {
                        doc.addPage();
                        currentY = topMargin + 30; // Start below header
                        addHeader();
                    }


                    doc
                        .font('Helvetica-Bold')
                        .fontSize(12)
                        .fillColor('#1f2937')
                        .text('Transactions', 40, currentY);
                    currentY += 20;

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
                            .fill('#4f46e5')
                            .rect(tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3] + txColWidths[4], txTableTop, txColWidths[5], txRowHeight)
                            .fill('#4f46e5');

                        doc
                            .fillColor('#ffffff')
                            .text('Type', tableLeft + 5, txTableTop + 8, { width: txColWidths[0] - 10, align: 'center' })
                            .text('Date', tableLeft + txColWidths[0] + 5, txTableTop + 8, { width: txColWidths[1] - 10, align: 'center' })
                            .text('Customer', tableLeft + txColWidths[0] + txColWidths[1] + 5, txTableTop + 8, { width: txColWidths[2] - 10, align: 'center', ellipsis: true })
                            .text('Description', tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + 5, txTableTop + 8, { width: txColWidths[3] - 10, align: 'left', ellipsis: true })
                            .text('Category', tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3] + 5, txTableTop + 8, { width: txColWidths[4] - 10, align: 'center' })
                            .text('Amount', tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3] + txColWidths[4] + 5, txTableTop + 8, { width: txColWidths[5] - 10, align: 'right' });

                        doc
                            .rect(tableLeft, txTableTop, txColWidths[0], txRowHeight)
                            .rect(tableLeft + txColWidths[0], txTableTop, txColWidths[1], txRowHeight)
                            .rect(tableLeft + txColWidths[0] + txColWidths[1], txTableTop, txColWidths[2], txRowHeight)
                            .rect(tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2], txTableTop, txColWidths[3], txRowHeight)
                            .rect(tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3], txTableTop, txColWidths[4], txRowHeight)
                            .rect(tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3] + txColWidths[4], txTableTop, txColWidths[5], txRowHeight)
                            .strokeColor('#d1d5db')
                            .stroke();
                    };

                    addTxTableHeader();
                    currentY += txRowHeight;

                    console.log('Rendering transactions:', reportData.transactions.length);
                    reportData.transactions.forEach((t, index) => {
                        const y = currentY; // Use currentY for the row position
                        console.log(`Transaction ${index + 1} - y: ${y}, pageHeight: ${pageHeight}, usableHeight: ${usableHeight}`);

                        // Check if the row would exceed the usable height
                        if (y + txRowHeight > usableHeight) {
                            doc.addPage();
                            currentY = topMargin + 30; // Start below header
                            txTableTop = currentY;
                            addHeader();
                            addTxTableHeader();
                            currentY += txRowHeight;
                            console.log(`New page added for transaction ${index + 1}, reset currentY to ${currentY}`);
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
                            .rect(tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3], currentY, txColWidths[4], txRowHeight)
                            .fill(index % 2 === 0 ? '#f9fafb' : '#ffffff')
                            .rect(tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3] + txColWidths[4], currentY, txColWidths[5], txRowHeight)
                            .fill(index % 2 === 0 ? '#f9fafb' : '#ffffff');

                        doc
                            .fillColor('#374151')
                            .text(t.type === 'receipt' ? 'Credit' : 'Debit', tableLeft + 5, currentY + 8, { width: txColWidths[0] - 10, align: 'center' })
                            .text(t.date ? new Date(t.date).toISOString().split('T')[0] : 'N/A', tableLeft + txColWidths[0] + 5, currentY + 8, { width: txColWidths[1] - 10, align: 'center' })
                            .text(t.customerId?.name || 'N/A', tableLeft + txColWidths[0] + txColWidths[1] + 5, currentY + 8, { width: txColWidths[2] - 10, align: 'center', ellipsis: true })
                            .text(truncateDescription(t.description), tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + 5, currentY + 8, { width: txColWidths[3] - 10, align: 'left', ellipsis: true })
                            .text(truncateDescription(t.category || 'N/A'), tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3] + 5, currentY + 13, { width: txColWidths[4] - 5, align: 'center' })
                            .fillColor(t.type === 'receipt' ? '#10b981' : '#ef4444')
                            .text(` ${cleanAmount(t.amount).toFixed(2)}`, tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3] + txColWidths[4] + 5, currentY + 8, { width: txColWidths[5] - 10, align: 'right' });

                        doc
                            .rect(tableLeft, currentY, txColWidths[0], txRowHeight)
                            .rect(tableLeft + txColWidths[0], currentY, txColWidths[1], txRowHeight)
                            .rect(tableLeft + txColWidths[0] + txColWidths[1], currentY, txColWidths[2], txRowHeight)
                            .rect(tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2], currentY, txColWidths[3], txRowHeight)
                            .rect(tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3], currentY, txColWidths[4], txRowHeight)
                            .rect(tableLeft + txColWidths[0] + txColWidths[1] + txColWidths[2] + txColWidths[3] + txColWidths[4], currentY, txColWidths[5], txRowHeight)
                            .strokeColor('#d1d5db')
                            .stroke();

                        currentY += txRowHeight; // Increment currentY after rendering the row
                    });
                }
                doc.end();

                // Wait for PDF to finish writing
                await new Promise((resolve, reject) => {
                    writeStream.on('finish', resolve);
                    writeStream.on('error', (err) => {
                        console.error('Error writing PDF stream:', err);
                        reject(err);
                    });
                });

                // Verify file exists before reading
                try {
                    await fs.access(filePath);
                } catch (err) {
                    console.error('File does not exist:', filePath);
                    throw new Error('Failed to create PDF file');
                }

                // Read the PDF file and upload to Vercel Blob
                const pdfBuffer = await fs.readFile(filePath);
                const blob = await put(`reports/${filename}`, pdfBuffer, {
                    access: 'public',
                    addRandomSuffix: true,
                    token: process.env.BLOB_READ_WRITE_TOKEN,
                });

                // Clean up temporary file
                await fs.unlink(filePath).catch((err) => console.error('Error deleting temp file:', err));

                res.json({ url: blob.url });
                await fs.unlink(filePath).catch((err) => console.error('Error deleting temp file:', err));

            } catch (pdfError) {
                console.error('PDF Generation Error:', pdfError);
                if (filePath) {
                    await fs.unlink(filePath).catch(cleanupError => {
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
                pageSetup: { fitToPage: true, fitToWidth: 1, margins: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75 } },
            });

            // Header
            try {
                let logoBuffer;
                try {
                    const response = await axios.get(settings.logo, { responseType: 'arraybuffer' });
                    logoBuffer = Buffer.from(response.data);
                } catch (error) {
                    console.error('Error fetching logo image:', error.message);
                    logoBuffer = null; // Handle fallback in addHeader
                }
                const logo = workbook.addImage({
                    buffer: logoBuffer,
                    extension: 'png',
                });
                worksheet.addImage(logo, {
                    tl: { col: 0, row: 0 },
                    ext: { width: 80, height: 80 },
                });
            } catch {
                worksheet.addRow([settings.sitename]).font = { size: 16, bold: true, color: { argb: 'FF4F46E5' } };
                worksheet.mergeCells('A1:F1');
            }

            worksheet.mergeCells('C1:F1');
            worksheet.getCell('C1').value = 'Financial Summary Report';
            worksheet.getCell('C1').font = { size: 16, bold: true, color: { argb: 'FF1F2937' } };
            worksheet.getCell('C1').alignment = { horizontal: 'center', vertical: 'middle' };
            worksheet.mergeCells('C2:F2');
            worksheet.getCell('C2').value = `Generated on: ${new Date().toLocaleDateString('en-US', { dateStyle: 'medium' })}`;
            worksheet.getCell('C2').font = { size: 10, color: { argb: 'FF6B7280' } };
            worksheet.getCell('C2').alignment = { horizontal: 'center', vertical: 'middle' };
            if (customerId && reportData.transactions[0]?.customerId?.name) {
                worksheet.mergeCells('C3:F3');
                worksheet.getCell('C3').value = `Customer: ${reportData.transactions[0].customerId.name}`;
                worksheet.getCell('C3').font = { size: 10, color: { argb: 'FF6B7280' } };
                worksheet.getCell('C3').alignment = { horizontal: 'center', vertical: 'middle' };
            } else if (isAdmin) {
                worksheet.mergeCells('C3:F3');
                worksheet.getCell('C3').value = 'All Users';
                worksheet.getCell('C3').font = { size: 10, color: { argb: 'FF6B7280' } };
                worksheet.getCell('C3').alignment = { horizontal: 'center', vertical: 'middle' };
            }
            worksheet.addRow([]);
            worksheet.getRow(4).height = 10;

            worksheet.mergeCells('A5:F5');
            worksheet.getCell('A5').value = 'Summary';
            worksheet.getCell('A5').font = { size: 14, bold: true, color: { argb: 'FF1F2937' } };
            worksheet.getCell('A5').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
            worksheet.getCell('A5').alignment = { horizontal: 'center' };
            worksheet.addRow([
                'Period',
                `${startDate ? new Date(startDate).toLocaleDateString('en-US') : 'N/A'} to ${endDate ? new Date(endDate).toLocaleDateString('en-US') : 'N/A'}`,
                '',
                '',
                '',
                '',
            ]).font = { size: 11 };
            worksheet.addRow(['Opening Balance', ` ${cleanAmount(openingBalance).toFixed(2)}`, '', '', '', '']).font = { size: 11, color: { argb: 'FF374151' } };
            worksheet.addRow(['Total Credits', ` ${cleanAmount(totalReceipts).toFixed(2)}`, '', '', '', '']).font = { size: 11, color: { argb: 'FF10B981' } };
            worksheet.addRow(['Total Debits', ` ${cleanAmount(totalPayments).toFixed(2)}`, '', '', '', '']).font = { size: 11, color: { argb: 'FFEF4444' } };
            worksheet.addRow(['Closing Balance', ` ${cleanAmount(reportData.balance).toFixed(2)}`, '', '', '', '']).font = {
                size: 11,
                bold: true,
                color: { argb: reportData.balance >= 0 ? 'FF10B981' : 'FFEF4444' },
            };
            for (let i = 6; i <= 9; i++) {
                worksheet.getRow(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
                worksheet.getRow(i).height = 20;
            }
            worksheet.addRow([]);

            worksheet.mergeCells(`A${worksheet.rowCount}:F${worksheet.rowCount}`);
            worksheet.getCell(`A${worksheet.rowCount}`).value = 'Category Summary';
            worksheet.getCell(`A${worksheet.rowCount}`).font = { size: 14, bold: true, color: { argb: 'FF1F2937' } };
            worksheet.getCell(`A${worksheet.rowCount}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
            worksheet.getCell(`A${worksheet.rowCount}`).alignment = { horizontal: 'center' };
            const catHeaderRow = worksheet.addRow(['Category', 'Amount', '', '', '', '']);
            catHeaderRow.font = { size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
            catHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
            catHeaderRow.alignment = { horizontal: 'center', vertical: 'middle' };
            catHeaderRow.height = 25;
            Object.entries(categorySummary).forEach(([category, amount], index) => {
                const row = worksheet.addRow([category, ` ${cleanAmount(amount).toFixed(2)}`, '', '', '', '']);
                row.font = { size: 11 };
                row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index % 2 === 0 ? 'FFF9FAFB' : 'FFFFFFFF' } };
                row.getCell(2).font = { color: { argb: cleanAmount(amount) >= 0 ? 'FF10B981' : 'FFEF4444' } };
                row.getCell(2).alignment = { horizontal: 'right', vertical: 'middle' };
                row.height = 20;
            });
            worksheet.addRow([]);

            worksheet.mergeCells(`A${worksheet.rowCount}:F${worksheet.rowCount}`);
            worksheet.getCell(`A${worksheet.rowCount}`).value = 'Transactions';
            worksheet.getCell(`A${worksheet.rowCount}`).font = { size: 14, bold: true, color: { argb: 'FF1F2937' } };
            worksheet.getCell(`A${worksheet.rowCount}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
            worksheet.getCell(`A${worksheet.rowCount}`).alignment = { horizontal: 'center' };
            worksheet.columns = [
                { header: 'Type', key: 'type', width: 12 },
                { header: 'Date', key: 'date', width: 15 },
                { header: 'Customer', key: 'customer', width: 20 },
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
                    type: t.type,
                    date: t.date ? t.date.toISOString().split('T')[0] : 'N/A',
                    customer: t.customerId?.name || 'N/A',
                    description: t.description || 'N/A',
                    category: t.category || 'N/A',
                    amount: ` ${cleanAmount(t.amount).toFixed(2)}`,
                });
                row.font = { size: 11 };
                row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index % 2 === 0 ? 'FFF9FAFB' : 'FFFFFFFF' } };
                row.getCell('amount').font = { color: { argb: t.type === 'receipt' ? 'FF10B981' : 'FFEF4444' } };
                row.getCell('amount').alignment = { horizontal: 'right', vertical: 'middle' };
                row.getCell('type').alignment = { horizontal: 'center', vertical: 'middle' };
                row.getCell('date').alignment = { horizontal: 'center', vertical: 'middle' };
                row.getCell('customer').alignment = { horizontal: 'center', vertical: 'middle' };
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
                    ['A', 'B', 'C', 'D', 'E', 'F'].forEach((col) => {
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
            addBorders(11, 11 + Object.keys(categorySummary).length);
            addBorders(14 + Object.keys(categorySummary).length, 14 + Object.keys(categorySummary).length + reportData.transactions.length);

            const filename = `report-${Date.now()}.xlsx`;
            const filePath = path.join(tempDir, filename);
            await workbook.xlsx.writeFile(filePath);

            // Verify file exists before reading
            try {
                await fs.access(filePath);
            } catch (err) {
                console.error('File does not exist:', filePath);
                throw new Error('Failed to create Excel file');
            }

            // Read the Excel file and upload to Vercel Blob
            const excelBuffer = await fs.readFile(filePath);
            const blob = await put(`reports/${filename}`, excelBuffer, {
                access: 'public',
                addRandomSuffix: true,
                token: process.env.BLOB_READ_WRITE_TOKEN,
            });

            // Clean up temporary file
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