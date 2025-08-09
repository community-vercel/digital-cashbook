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
      // Update existing setting - Remove manual timestamp assignment
      const updateData = {};
      
      if (siteName) updateData.siteName = siteName;
      if (phone) updateData.phone = phone;
      if (logoUrl) updateData.logo = logoUrl;
      
      // Handle opening balance only if not already set
      if (openingBalance !== undefined && !setting.openingBalanceSet) {
        updateData.openingBalance = parseFloat(openingBalance) || 0;
        updateData.openingBalanceSet = true;
      }
      
      // Use findOneAndUpdate to properly handle timestamps
      setting = await Setting.findOneAndUpdate(
        { shopId: selectedShopId },
        updateData,
        { 
          new: true, // Return updated document
          runValidators: true // Run schema validations
        }
      );
      
      res.json(setting);
    } else {
      // Create new setting
      const newSettingData = {
        siteName: siteName || 'Default Store',
        phone: phone || '',
        shopId: selectedShopId,
        openingBalance: parseFloat(openingBalance) || 0,
        openingBalanceSet: true,
      };
      
      // Only add logo if provided
      if (logoUrl) {
        newSettingData.logo = logoUrl;
      }
      
      setting = new Setting(newSettingData);
      await setting.save();
      res.status(201).json(setting);
    }
  } catch (error) {
    console.error('Save settings failed:', error);
    
    // Better error handling for validation errors
    if (error.name === 'ValidationError') {
      const errorMessages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ 
        message: 'Validation failed',
        errors: errorMessages
      });
    }
    
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
      const defaultSettingData = {
        shopId: selectedShopId,
        siteName: shop.name || 'Default Store',
        phone: shop.phone || '',
        currency: 'PKR',
        openingBalance: 0,
        openingBalanceSet: false
      };
      
      setting = new Setting(defaultSettingData);
      await setting.save();
    }

    res.json(setting);
  } catch (error) {
    console.error('Get settings failed:', error);
    res.status(500).json({ 
      message: 'Server error: Failed to fetch settings',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
  }
};