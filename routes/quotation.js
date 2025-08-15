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

    // Always use 'all' for quotations - no shop restriction
    const selectedShopId = 'all';
    
    // Get default company info
    let defaultShop = null;
    let defaultSettings = null;
    
    try {
      defaultShop = await Shop.findOne().sort({ createdAt: 1 });
      if (defaultShop) {
        defaultSettings = await Setting.findOne({ shopId: defaultShop._id });
      }
    } catch (error) {
      console.warn('Could not fetch default shop settings:', error.message);
    }

    // Fetch customer
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    // Fetch products
    const productIds = products.map(p => p.productId);
    const productList = await Product.find({ _id: { $in: productIds } });
    
    if (productList.length === 0) {
      return res.status(404).json({ message: 'No products found' });
    }

    // Generate PDF
    const doc = new PDFDocument({ 
      margin: 40, 
      size: 'A4',
      bufferPages: true
    });
    
    const filename = `quotation-${Date.now()}.pdf`;
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));

    // Company information
    const companyName = defaultSettings?.siteName || defaultShop?.name || 'Al Waqas';
    const companyPhone = defaultSettings?.phone || defaultShop?.phone || '+923335093223';
    const companyAddress = defaultShop?.address || 'Nadir Plaza, Opposite Lignum Tower, DHA 2, Near Al Janat Mall, GT Road, Islamabad, Pakistan';
    const companyLogo = defaultSettings?.logo;

    // Colors
    const black = '#000000';
    const white = '#FFFFFF';

    let currentY = 40;

    // **HEADER SECTION**
    // Company Logo
    if (companyLogo) {
      try {
        const logoBuffer = await downloadImage(companyLogo);
        doc.image(logoBuffer, 40, currentY, { 
          width: 60, 
          height: 60,
          fit: [60, 60],
          align: 'center',
          valign: 'center'
        });
      } catch (error) {
        console.warn('Failed to load logo:', error.message);
        // Simple logo placeholder
        const initial = companyName.charAt(0).toUpperCase();
        doc.circle(70, currentY + 30, 30)
           .fill(black);
        doc.font('Helvetica-Bold')
           .fontSize(24)
           .fillColor(white)
           .text(initial, 62, currentY + 18, {
             width: 16,
             align: 'center'
           });
      }
    } else {
      // Simple logo placeholder
      const initial = companyName.charAt(0).toUpperCase();
      doc.circle(70, currentY + 30, 30)
         .fill(black);
      doc.font('Helvetica-Bold')
         .fontSize(24)
         .fillColor(white)
         .text(initial, 62, currentY + 18, {
           width: 16,
           align: 'center'
         });
    }

    // Company Details
    doc.font('Helvetica-Bold')
       .fontSize(24)
       .fillColor(black)
       .text(companyName, 120, currentY);
    
    // Adjust address to prevent overlap
    doc.font('Helvetica')
       .fontSize(11)
       .fillColor(black);
    
    const addressLine1 = 'Nadir Plaza, Opposite Lignum Tower, DHA 2';
    const addressLine2 = 'Near Al Janat Mall, GT Road, Islamabad, Pakistan';
    
    doc.text(addressLine1, 120, currentY + 28, { width: 280 });
    doc.text(addressLine2, 120, currentY + 42, { width: 280 });
    doc.text(`Phone: ${companyPhone}`, 120, currentY + 56);

    // Quotation Badge
    const quotationNumber = `QT-${Date.now().toString().slice(-8)}`;
    const badgeX = 420;
    
    doc.rect(badgeX, currentY, 135, 60)
       .stroke(black);
    
    doc.font('Helvetica-Bold')
       .fontSize(16)
       .fillColor(black)
       .text('QUOTATION', badgeX + 20, currentY + 10);
    
    doc.font('Helvetica')
       .fontSize(9)
       .fillColor(black)
       .text(`Quote #: ${quotationNumber}`, badgeX + 20, currentY + 30)
       .text(`Date: ${new Date().toLocaleDateString()}`, badgeX + 20, currentY + 44);

    currentY += 80;

    // Divider line
    doc.moveTo(40, currentY)
       .lineTo(555, currentY)
       .stroke(black);
    
    currentY += 20;

    // **CUSTOMER SECTION**
    doc.font('Helvetica-Bold')
       .fontSize(12)
       .fillColor(black)
       .text('BILL TO:', 40, currentY);
    
    currentY += 20;
    
    doc.rect(40, currentY, 250, 70)
       .stroke(black);
    
    doc.font('Helvetica-Bold')
       .fontSize(14)
       .fillColor(black)
       .text(customer.name, 50, currentY + 15);
    
    doc.font('Helvetica')
       .fontSize(10)
       .fillColor(black)
       .text(`Phone: ${customer.phone || 'N/A'}`, 50, currentY + 35)
       .text(`Email: ${customer.email || 'N/A'}`, 50, currentY + 50);

    // Quote validity
    doc.rect(310, currentY, 245, 70)
       .stroke(black);
    
    doc.font('Helvetica-Bold')
       .fontSize(12)
       .fillColor(black)
       .text('QUOTE VALIDITY', 320, currentY + 15);
    
    doc.font('Helvetica')
       .fontSize(10)
       .fillColor(black)
       .text('Valid for 30 days from issue date', 320, currentY + 35)
       .text(`Expires: ${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString()}`, 320, currentY + 50);

    currentY += 90;

    // **PRODUCTS TABLE**
    const tableTop = currentY;
    const colWidths = [180, 45, 70, 70, 70, 80];
    const tableLeft = 40;
    const rowHeight = 25;
    const tableWidth = colWidths.reduce((a, b) => a + b, 0);

    // Table Header
    doc.rect(tableLeft, tableTop, tableWidth, 30)
       .stroke(black);
    
    doc.font('Helvetica-Bold')
       .fontSize(10)
       .fillColor(black);
    
    const headers = ['Product Name', 'Qty', 'Cost', 'Retail', 'Sale', 'Total'];
    
    headers.forEach((header, i) => {
      const x = tableLeft + colWidths.slice(0, i).reduce((a, b) => a + b, 0);
      doc.text(header, x + 5, tableTop + 10, {
        width: colWidths[i] - 10,
        align: i === 0 ? 'left' : 'center'
      });
    });

    // Table Rows
    let y = tableTop + 30;
    let total = 0;
    let rowIndex = 0;

    products.forEach((item) => {
      const product = productList.find((p) => p._id.toString() === item.productId);
      if (!product) return;
      
      const salePrice = typeof item.salePrice === 'string' ? parseFloat(p.salePrice) : item.salePrice;
      const safeSalePrice = typeof salePrice === 'number' && !isNaN(salePrice) ? salePrice : 0;
      const lineTotal = safeSalePrice * item.quantity;
      total += lineTotal;

      // Row background (no fill for simplicity)
      doc.rect(tableLeft, y, tableWidth, rowHeight)
         .stroke(black);

      // Row content
      doc.font('Helvetica')
         .fontSize(9)
         .fillColor(black);
      
      const values = [
        product.name.length > 25 ? product.name.substring(0, 25) + '...' : product.name,
        item.quantity.toString(),
        (item.costPrice || 0).toFixed(0),
        (item.retailPrice || 0).toFixed(0),
        safeSalePrice.toFixed(0),
        lineTotal.toFixed(0)
      ];

      values.forEach((value, i) => {
        const x = tableLeft + colWidths.slice(0, i).reduce((a, b) => a + b, 0);
        doc.text(value, x + 5, y + 8, {
          width: colWidths[i] - 10,
          align: i === 0 ? 'left' : 'center'
        });
      });

      y += rowHeight;
      rowIndex++;
    });

    // Table border
    doc.rect(tableLeft, tableTop, tableWidth, y - tableTop)
       .stroke(black);

    // **TOTAL SECTION**
    currentY = y + 20;
    
    // Total box
    const totalBoxWidth = 180;
    const totalBoxX = tableLeft + tableWidth - totalBoxWidth;
    
    doc.rect(totalBoxX, currentY, totalBoxWidth, 40)
       .stroke(black);
    
    doc.font('Helvetica-Bold')
       .fontSize(12)
       .fillColor(black)
       .text('GRAND TOTAL', totalBoxX + 10, currentY + 8);
    
    doc.font('Helvetica-Bold')
       .fontSize(16)
       .fillColor(black)
       .text(formatCurrency(total), totalBoxX + 10, currentY + 22);

    currentY += 60;

    // **TERMS & CONDITIONS**
    if (currentY < 650) {
      doc.rect(40, currentY, 515, 80)
         .stroke(black);
      
      doc.font('Helvetica-Bold')
         .fontSize(11)
         .fillColor(black)
         .text('TERMS & CONDITIONS', 50, currentY + 12);
      
      doc.font('Helvetica')
         .fontSize(9)
         .fillColor(black)
         .text('• This quotation is valid for 30 days from the date of issue', 50, currentY + 30)
         .text('• Prices are subject to change without prior notice', 50, currentY + 44)
         .text('• Payment terms as per mutual agreement', 50, currentY + 58);
    }

    // **FOOTER**
    const footerY = 750;
    
    doc.moveTo(40, footerY)
       .lineTo(555, footerY)
       .stroke(black);
    
    doc.font('Helvetica-Bold')
       .fontSize(12)
       .fillColor(black)
       .text('Thank you for your business!', 0, footerY + 20, { align: 'center' });
    
    doc.font('Helvetica')
       .fontSize(8)
       .fillColor(black)
       .text(`${companyPhone} | Generated on ${new Date().toLocaleString()}`, 0, footerY + 40, { align: 'center' });

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
      quotationNumber,
      productsFound: productList.length,
      productsRequested: products.length
    });

  } catch (error) {
    console.error('Error generating quotation:', error);
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;