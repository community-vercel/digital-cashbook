const express = require('express');
const router = express.Router();
const PDFDocument = require('pdfkit');
const { put } = require('@vercel/blob');
const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const Product = require('../models/Product');
const Customer = require('../models/Customer');
const Shop = require('../models/Shop');
const Setting = require('../models/Setting');
const authMiddleware = require('../middleware/auth');
const mongoose = require('mongoose');
const os = require('os');

// Helper function to download image from URL
const downloadImage = (url) => {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : require('http');
    protocol.get(url, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
};

// Helper function to format currency
const formatCurrency = (amount) => `PKR ${amount.toFixed(2)}`;

router.post('/generate', authMiddleware, async (req, res) => {
  try {
    const { customerId, shopId, products } = req.body;

    // Validate inputs
    if (!customerId || !products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ message: 'Customer ID and products are required' });
    }

    // Validate product data
    const invalidProduct = products.find(p => {
      const salePrice = typeof p.salePrice === 'string' ? parseFloat(p.salePrice) : p.salePrice;
      return !p.productId || p.quantity <= 0 || p.costPrice < 0 || p.retailPrice < 0 || 
             typeof salePrice !== 'number' || isNaN(salePrice) || salePrice < 0;
    });

    if (invalidProduct) {
      console.error('Invalid product data:', invalidProduct);
      return res.status(400).json({ message: 'Invalid product data or prices' });
    }

    // Determine shop selection
    let selectedShopId = req.user.shopId;
    let shop = null;
    
    if (req.user.role === 'superadmin' && shopId) {
      if (shopId !== 'all' && !mongoose.Types.ObjectId.isValid(shopId)) {
        return res.status(400).json({ message: 'Invalid shopId' });
      }
      selectedShopId = shopId === 'all' ? null : shopId;
    } else if (!selectedShopId && req.user.role !== 'superadmin') {
      return res.status(400).json({ message: 'Shop ID required for non-superadmin users' });
    }

    // Fetch shop and settings
    let shopSettings = null;
    if (selectedShopId) {
      [shop, shopSettings] = await Promise.all([
        Shop.findById(selectedShopId),
        Setting.findOne({ shopId: selectedShopId })
      ]);
      
      if (!shop) {
        return res.status(404).json({ message: 'Shop not found' });
      }
    }

    // Fetch customer
    const customerQuery = { _id: customerId };
    if (selectedShopId) customerQuery.shopId = selectedShopId;
    
    const customer = await Customer.findOne(customerQuery);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    // Fetch products
    const productIds = products.map(p => p.productId);
    const productQuery = { _id: { $in: productIds } };
    if (selectedShopId) productQuery.shopId = selectedShopId;
    
    const productList = await Product.find(productQuery);
    if (productList.length !== productIds.length) {
      return res.status(404).json({ message: 'One or more products not found' });
    }

    // Generate PDF
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const filename = `quotation-${Date.now()}.pdf`;
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));

    // Use shop settings for company info
    const companyName = shopSettings?.siteName || shop?.name || 'Al Waqas';
    const companyPhone = shopSettings?.phone || shop?.phone || '+923335093223';
    const companyAddress = shop?.address || 'DHA 2, Near Al Janat Mall Islamabad';
    const companyLogo = shopSettings?.logo;

    let currentY = 40;

    // Header Section
    if (companyLogo) {
      try {
        const logoBuffer = await downloadImage(companyLogo);
        doc.image(logoBuffer, 40, currentY, { width: 60, height: 45 });
      } catch (error) {
        console.warn('Failed to load logo:', error.message);
      }
    }

    // Company details (left side)
    doc.font('Helvetica-Bold').fontSize(20).fillColor('#2563eb')
       .text(companyName, 120, currentY);
    
    doc.font('Helvetica').fontSize(10).fillColor('#6b7280')
       .text(companyAddress, 120, currentY + 25)
       .text(`Phone: ${companyPhone}`, 120, currentY + 40);

    // Quotation details (right side)
    const quotationNumber = `QT-${Date.now().toString().slice(-8)}`;
    doc.font('Helvetica-Bold').fontSize(24).fillColor('#dc2626')
       .text('QUOTATION', 400, currentY, { align: 'right' });
    
    doc.font('Helvetica').fontSize(10).fillColor('#6b7280')
       .text(`Quote #: ${quotationNumber}`, 400, currentY + 30, { align: 'right' })
       .text(`Date: ${new Date().toLocaleDateString()}`, 400, currentY + 45, { align: 'right' });

    currentY += 80;

    // Horizontal line
    doc.moveTo(40, currentY).lineTo(555, currentY).strokeColor('#e5e7eb').lineWidth(1).stroke();
    currentY += 20;

    // Customer details
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#374151')
       .text('Bill To:', 40, currentY);
    
    currentY += 15;
    doc.font('Helvetica').fontSize(11).fillColor('#6b7280')
       .text(customer.name, 40, currentY)
       .text(customer.phone || 'N/A', 40, currentY + 15)
       .text(customer.email || 'N/A', 40, currentY + 30);

    currentY += 60;

    // Products Table
    const tableTop = currentY;
    const colWidths = [200, 60, 75, 75, 75, 70];
    const tableLeft = 40;
    const rowHeight = 25;

    // Table Header
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff');
    const headers = ['Product', 'Qty', 'Cost Price', 'Retail Price', 'Sale Price', 'Total'];
    
    headers.forEach((header, i) => {
      const x = tableLeft + colWidths.slice(0, i).reduce((a, b) => a + b, 0);
      doc.rect(x, tableTop, colWidths[i], rowHeight).fill('#4f46e5');
      doc.fillColor('#ffffff').text(header, x + 5, tableTop + 8, {
        width: colWidths[i] - 10,
        align: i === 0 ? 'left' : 'center',
      });
    });

    // Table Rows
    let y = tableTop + rowHeight;
    let total = 0;

    products.forEach((item, index) => {
      const product = productList.find((p) => p._id.toString() === item.productId);
      if (!product) return;
      
      const salePrice = typeof item.salePrice === 'string' ? parseFloat(item.salePrice) : item.salePrice;
      const safeSalePrice = typeof salePrice === 'number' && !isNaN(salePrice) ? salePrice : 0;
      const lineTotal = safeSalePrice * item.quantity;
      total += lineTotal;

      // Alternating row background
      if (index % 2 === 0) {
        doc.rect(tableLeft, y, colWidths.reduce((a, b) => a + b, 0), rowHeight).fill('#f9fafb');
      }

      // Row content
      doc.font('Helvetica').fontSize(9).fillColor('#374151');
      
      const values = [
        product.name.length > 25 ? product.name.substring(0, 25) + '...' : product.name,
        item.quantity.toString(),
        (item.costPrice || 0).toFixed(2),
        (item.retailPrice || 0).toFixed(2),
        safeSalePrice.toFixed(2),
        lineTotal.toFixed(2)
      ];

      values.forEach((value, i) => {
        const x = tableLeft + colWidths.slice(0, i).reduce((a, b) => a + b, 0);
        doc.text(value, x + 5, y + 8, {
          width: colWidths[i] - 10,
          align: i === 0 ? 'left' : 'center',
        });
      });

      // Row border
      doc.rect(tableLeft, y, colWidths.reduce((a, b) => a + b, 0), rowHeight)
         .strokeColor('#e5e7eb').lineWidth(0.5).stroke();

      y += rowHeight;
    });

    // Table border
    doc.rect(tableLeft, tableTop, colWidths.reduce((a, b) => a + b, 0), y - tableTop)
       .strokeColor('#d1d5db').lineWidth(1).stroke();

    // Total section
    const totalY = y + 15;
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#374151')
       .text(`Grand Total: ${formatCurrency(total)}`, tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3], totalY, { align: 'right' });

    // Terms (if space available)
    const termsY = totalY + 40;
    if (termsY < 700) { // Check if we have space
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#374151')
         .text('Terms & Conditions:', 40, termsY);
      
      doc.font('Helvetica').fontSize(9).fillColor('#6b7280')
         .text('• This quotation is valid for 30 days from the date of issue.', 40, termsY + 20)
         .text('• Prices are subject to change without prior notice.', 40, termsY + 35)
         .text('• Payment terms as per agreement.', 40, termsY + 50);
    }

    // Footer
    const footerY = 750;
    doc.moveTo(40, footerY).lineTo(555, footerY).strokeColor('#e5e7eb').lineWidth(1).stroke();
    
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#4f46e5')
       .text('Thank you for your business!', 40, footerY + 10, { align: 'center' });
    
    doc.font('Helvetica').fontSize(8).fillColor('#6b7280')
       .text(`Contact: ${companyPhone}`, 40, footerY + 25, { align: 'center' })
       .text(`Generated on ${new Date().toLocaleString()}`, 40, footerY + 35, { align: 'center' });

    doc.end();
    
    const pdfBuffer = await new Promise((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(buffers)));
    });

    // Save to blob storage
    const blob = await put(`quotations/${filename}`, pdfBuffer, {
      access: 'public',
      addRandomSuffix: true,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    res.json({ 
      url: blob.url, 
      total: formatCurrency(total), 
      customer,
      quotationNumber
    });

  } catch (error) {
    console.error('Error generating quotation:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;