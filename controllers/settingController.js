// controllers/settingController.js
const Setting = require('../models/Setting');
const { put } = require('@vercel/blob');
const mongoose = require('mongoose');
const Shop = require('../models/Shop');
exports.saveSettings = async (req, res) => {
  try {
    const { siteName, phone, logo, openingBalance, shopId } = req.body;
    
    // Check if user exists (authentication check)
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    
    let logoUrl = logo;

    let selectedShopId = req.user.shopId;
    
    // Handle superadmin shop selection
    if (req.user.role === 'superadmin' && shopId) {
      if (!mongoose.Types.ObjectId.isValid(shopId)) {
        return res.status(400).json({ message: 'Invalid shopId' });
      }
      selectedShopId = shopId;
    }
    
    if (!selectedShopId) {
      return res.status(400).json({ message: 'Shop ID required' });
    }

    // Handle logo upload
    if (req.files && req.files.logo) {
      const logoFile = req.files.logo;
      const fileName = `${Date.now()}-${logoFile.name}`;
      const { url } = await put(fileName, logoFile.data, {
        access: 'public',
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      logoUrl = url;
    }

    // Find or create setting
    let setting = await Setting.findOne({ shopId: selectedShopId });
    if (setting) {
      // Update existing setting
      setting.siteName = siteName || setting.siteName;
      setting.phone = phone || setting.phone;
      if (openingBalance !== undefined && !setting.openingBalanceSet) {
        setting.openingBalance = parseFloat(openingBalance) || 0;
        setting.openingBalanceSet = true;
      }
      if (logoUrl) setting.logo = logoUrl;
      setting.updatedAt = Date.now();
      await setting.save();
      res.json(setting);
    } else {
      // Create new setting
      setting = new Setting({
        siteName,
        phone,
        logo: logoUrl,
        openingBalance: parseFloat(openingBalance) || 0,
        openingBalanceSet: true,
        shopId: selectedShopId,
      });
      await setting.save();
      res.status(201).json(setting);
    }
  } catch (error) {
    console.error('Save settings failed:', error);
    res.status(500).json({ 
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
  }
};

exports.getSettings = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Unauthorized: No user authenticated' });
    }

    let selectedShopId = req.user.shopId;
    if (req.user.role === 'superadmin' && req.query.shopId) {
      if (!mongoose.Types.ObjectId.isValid(req.query.shopId)) {
        return res.status(400).json({ message: 'Invalid shopId' });
      }
      selectedShopId = req.query.shopId;
    }

    if (!selectedShopId) {
      return res.status(400).json({ message: 'Shop ID required' });
    }

    let setting = await Setting.findOne({ shopId: selectedShopId });
    if (!setting) {
      // Check if shop exists
      const shop = await Shop.findById(selectedShopId);
      if (!shop) {
        return res.status(404).json({ message: 'Shop not found' });
      }
      // Create default settings if none exist
      setting = await Setting.create({
        shopId: selectedShopId,
        siteName: shop.name || 'Default Store',
        currency: 'PKR', // Default currency, adjust as needed
        openingBalance: 0,
        // Add other default settings as needed
      });
    }

    res.json(setting);
  } catch (error) {
    console.error('Get settings failed:', error);
    res.status(500).json({ message: 'Server error: Failed to fetch settings' });
  }
};