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

    // **SIMPLIFIED**: Always use 'all' for quotations - no shop restriction
    const selectedShopId = 'all';
    
    // Get default company info (can be from any shop or default settings)
    let defaultShop = null;
    let defaultSettings = null;
    
    try {
      defaultShop = await Shop.findOne().sort({ createdAt: 1 }); // Get first shop as default
      if (defaultShop) {
        defaultSettings = await Setting.findOne({ shopId: defaultShop._id });
      }
    } catch (error) {
      console.warn('Could not fetch default shop settings:', error.message);
    }

    // **FIXED**: Fetch customer without shop restriction
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    // **FIXED**: Fetch products without shop restriction
    const productIds = products.map(p => p.productId);
    const productList = await Product.find({ _id: { $in: productIds } });
    
    if (productList.length === 0) {
      return res.status(404).json({ message: 'No products found' });
    }

    // Generate PDF with clean, professional design
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
    const companyAddress = defaultShop?.address || 'DHA 2, Near Al Janat Mall Islamabad';
    const companyLogo = defaultSettings?.logo;

    // Colors
    const primaryColor = '#2563EB';
    const secondaryColor = '#F8FAFC';
    const textColor = '#1F2937';
    const lightTextColor = '#6B7280';
    const successColor = '#059669';

    let currentY = 40;

    // **HEADER SECTION**
    // Company Logo
   
// **HEADER SECTION**
// Company Logo with improved rounded design
if (companyLogo) {
  try {
    const logoBuffer = await downloadImage(companyLogo);
    
    // Create a circular clipping path for the logo
    doc.save();
    doc.circle(70, currentY + 30, 30)
       .clip();
    
    // Draw the logo image within the circular clip
    doc.image(logoBuffer, 40, currentY, { 
      width: 60, 
      height: 60,
      fit: [60, 60],
      align: 'center',
      valign: 'center'
    });
    
    doc.restore();
    
    // Add a subtle border around the circular logo
    doc.circle(70, currentY + 30, 30)
       .stroke('#E5E7EB', 2);
    
  } catch (error) {
    console.warn('Failed to load logo:', error.message);
    // Enhanced logo placeholder with gradient effect
    createRoundedLogoPlaceholder(doc, companyName, 70, currentY + 30, primaryColor);
  }
} else {
  // Enhanced default logo placeholder
  createRoundedLogoPlaceholder(doc, companyName, 70, currentY + 30, primaryColor);
}
function createHexagonLogo(doc, companyName, centerX, centerY, primaryColor) {
  const radius = 30;
  const initial = companyName.charAt(0).toUpperCase();
  
  // Draw hexagon
  doc.save();
  doc.translate(centerX, centerY);
  
  // Create hexagon path
  doc.moveTo(radius, 0);
  for (let i = 1; i < 6; i++) {
    const angle = (i * 60 * Math.PI) / 180;
    doc.lineTo(radius * Math.cos(angle), radius * Math.sin(angle));
  }
  doc.closePath();
  doc.fill(primaryColor);
  
  // Add inner hexagon for depth
  const innerRadius = radius * 0.7;
  doc.moveTo(innerRadius, 0);
  for (let i = 1; i < 6; i++) {
    const angle = (i * 60 * Math.PI) / 180;
    doc.lineTo(innerRadius * Math.cos(angle), innerRadius * Math.sin(angle));
  }
  doc.closePath();
  doc.fill('rgba(255, 255, 255, 0.1)');
  
  doc.restore();
  
  // Company initial
  doc.font('Helvetica-Bold')
     .fontSize(22)
     .fillColor('white')
     .text(initial, centerX - 8, centerY - 11, {
       width: 16,
       align: 'center'
     });
}
// Helper function to create a beautiful rounded logo placeholder
function createRoundedLogoPlaceholder(doc, companyName, centerX, centerY, primaryColor) {
  // Outer circle with gradient effect (simulate with multiple circles)
  doc.circle(centerX, centerY, 32)
     .fill('#E5E7EB');
  
  doc.circle(centerX, centerY, 30)
     .fill(primaryColor);
  
  // Inner highlight circle for depth
  doc.circle(centerX - 8, centerY - 8, 8)
     .fill('rgba(255, 255, 255, 0.3)')
     .fillOpacity(0.3);
  
  // Company initial with better typography
  const initial = companyName.charAt(0).toUpperCase();
  
  doc.font('Helvetica-Bold')
     .fontSize(24)
     .fillColor('white')
     .fillOpacity(1)
     .text(initial, centerX - 8, centerY - 12, {
       width: 16,
       align: 'center'
     });
  
  // Subtle outer glow effect
  doc.circle(centerX, centerY, 33)
     .stroke('rgba(37, 99, 235, 0.2)', 1)
     .strokeOpacity(0.2);
}

// Alternative: More modern logo placeholder with icon-like design
function createModernLogoPlaceholder(doc, companyName, centerX, centerY, primaryColor) {
  // Background circle with soft shadow effect
  doc.circle(centerX + 1, centerY + 1, 30)
     .fill('#00000010'); // Very light shadow
  
  // Main circle
  doc.circle(centerX, centerY, 30)
     .fill(primaryColor);
  
  // Modern geometric pattern inside
  const initial = companyName.charAt(0).toUpperCase();
  
  // Create a small square rotated 45 degrees as background
  doc.save();
  doc.translate(centerX, centerY);
  doc.rotate(45 * Math.PI / 180);
  doc.rect(-8, -8, 16, 16)
     .fill('rgba(255, 255, 255, 0.2)');
  doc.restore();
  
  // Company initial
  doc.font('Helvetica-Bold')
     .fontSize(20)
     .fillColor('white')
     .text(initial, centerX - 7, centerY - 10, {
       width: 14,
       align: 'center'
     });
}


    // Company Details
    doc.font('Helvetica-Bold')
       .fontSize(24)
       .fillColor(primaryColor)
       .text(companyName, 120, currentY);
    
    doc.font('Helvetica')
       .fontSize(11)
       .fillColor(lightTextColor)
       .text(companyAddress, 120, currentY + 28)
       .text(`Phone: ${companyPhone}`, 120, currentY + 44);

    // Quotation Badge
    const quotationNumber = `QT-${Date.now().toString().slice(-8)}`;
    const badgeX = 420;
    
    doc.rect(badgeX, currentY, 135, 60)
       .fill(primaryColor);
    
    doc.font('Helvetica-Bold')
       .fontSize(16)
       .fillColor('white')
       .text('QUOTATION', badgeX + 20, currentY + 10);
    
    doc.font('Helvetica')
       .fontSize(9)
       .fillColor('white')
       .text(`Quote #: ${quotationNumber}`, badgeX + 20, currentY + 30)
       .text(`Date: ${new Date().toLocaleDateString()}`, badgeX + 20, currentY + 44);

    currentY += 80;

    // Divider line
    doc.moveTo(40, currentY)
       .lineTo(555, currentY)
       .stroke('#E5E7EB');
    
    currentY += 20;

    // **CUSTOMER SECTION**
    doc.font('Helvetica-Bold')
       .fontSize(12)
       .fillColor(textColor)
       .text('BILL TO:', 40, currentY);
    
    currentY += 20;
    
    doc.rect(40, currentY, 250, 70)
       .fill(secondaryColor)
       .stroke('#E5E7EB');
    
    doc.font('Helvetica-Bold')
       .fontSize(14)
       .fillColor(textColor)
       .text(customer.name, 50, currentY + 15);
    
    doc.font('Helvetica')
       .fontSize(10)
       .fillColor(lightTextColor)
       .text(`Phone: ${customer.phone || 'N/A'}`, 50, currentY + 35)
       .text(`Email: ${customer.email || 'N/A'}`, 50, currentY + 50);

    // Quote validity
    doc.rect(310, currentY, 245, 70)
       .fill('#FEF3C7')
       .stroke('#F59E0B');
    
    doc.font('Helvetica-Bold')
       .fontSize(12)
       .fillColor('#92400E')
       .text('QUOTE VALIDITY', 320, currentY + 15);
    
    doc.font('Helvetica')
       .fontSize(10)
       .fillColor('#92400E')
       .text('Valid for 30 days from issue date', 320, currentY + 35)
       .text(`Expires: ${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString()}`, 320, currentY + 50);

    currentY += 90;

    // **PRODUCTS TABLE**
    const tableTop = currentY;
    const colWidths = [180, 45, 70, 70, 70, 80]; // Adjusted to fit A4 width better
    const tableLeft = 40;
    const rowHeight = 25;
    const tableWidth = colWidths.reduce((a, b) => a + b, 0); // Total: 515px (fits in 555px page width)

    // Table Header
    doc.rect(tableLeft, tableTop, tableWidth, 30)
       .fill(primaryColor);
    
    doc.font('Helvetica-Bold')
       .fontSize(10)
       .fillColor('white');
    
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
      
      const salePrice = typeof item.salePrice === 'string' ? parseFloat(item.salePrice) : item.salePrice;
      const safeSalePrice = typeof salePrice === 'number' && !isNaN(salePrice) ? salePrice : 0;
      const lineTotal = safeSalePrice * item.quantity;
      total += lineTotal;

      // Row background
      const rowColor = rowIndex % 2 === 0 ? 'white' : '#F9FAFB';
      doc.rect(tableLeft, y, tableWidth, rowHeight)
         .fill(rowColor);

      // Row content
      doc.font('Helvetica')
         .fontSize(9)
         .fillColor(textColor);
      
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
       .stroke('#D1D5DB');

    // **TOTAL SECTION**
    currentY = y + 20;
    
    // Total box
    const totalBoxWidth = 180;
    const totalBoxX = tableLeft + tableWidth - totalBoxWidth;
    
    doc.rect(totalBoxX, currentY, totalBoxWidth, 40)
       .fill(successColor);
    
    doc.font('Helvetica-Bold')
       .fontSize(12)
       .fillColor('white')
       .text('GRAND TOTAL', totalBoxX + 10, currentY + 8);
    
    doc.font('Helvetica-Bold')
       .fontSize(16)
       .fillColor('white')
       .text(formatCurrency(total), totalBoxX + 10, currentY + 22);

    currentY += 60;

    // **TERMS & CONDITIONS**
    if (currentY < 650) {
      doc.rect(40, currentY, 515, 80)
         .fill('#F8FAFC')
         .stroke('#E5E7EB');
      
      doc.font('Helvetica-Bold')
         .fontSize(11)
         .fillColor(textColor)
         .text('TERMS & CONDITIONS', 50, currentY + 12);
      
      doc.font('Helvetica')
         .fontSize(9)
         .fillColor(lightTextColor)
         .text('• This quotation is valid for 30 days from the date of issue', 50, currentY + 30)
         .text('• Prices are subject to change without prior notice', 50, currentY + 44)
         .text('• Payment terms as per mutual agreement', 50, currentY + 58);
    }

    // **FOOTER**
    const footerY = 750;
    
    doc.rect(0, footerY, 595, 72)
       .fill('#F8FAFC');
    
    doc.moveTo(40, footerY)
       .lineTo(555, footerY)
       .stroke('#E5E7EB');
    
    doc.font('Helvetica-Bold')
       .fontSize(12)
       .fillColor(primaryColor)
       .text('Thank you for your business!', 0, footerY + 20, { align: 'center' });
    
    doc.font('Helvetica')
       .fontSize(8)
       .fillColor(lightTextColor)
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