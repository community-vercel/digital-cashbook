const Setting = require('../models/Setting');
const { put } = require('@vercel/blob');

// @desc Create or update settings
exports.saveSettings = async (req, res) => {
  try {
    const { siteName, phone, logo, openingBalance } = req.body;
    let logoUrl = req.body.logo; // For non-file updates (e.g., keeping existing logo)

    // Handle file upload if a logo file is provided
    if (req.files && req.files.logo) {
      const logoFile = req.files.logo;
      const fileName = `${Date.now()}-${logoFile.name}`; // Unique filename

      // Upload to Vercel Blob
      const { url } = await put(fileName, logoFile.data, {
        access: 'public',
        token: process.env.BLOB_READ_WRITE_TOKEN, // Vercel Blob token
      });

      logoUrl = url; // Set the logo URL to the Vercel Blob URL
    }

    let setting = await Setting.findOne();

    if (setting) {
      // Update existing settings
      setting.siteName = siteName || setting.siteName;
      setting.phone = phone || setting.phone;
       if (openingBalance !== undefined && !setting.openingBalanceSet) {
      setting.openingBalance = parseFloat(openingBalance) || 0;
      setting.openingBalanceSet = true;
    }

      if (logoUrl) setting.logo = logoUrl; // Update logo if provided
      setting.updatedAt = Date.now();
      await setting.save();
      res.json(setting);
    } else {
      // Create new settings
      setting = new Setting({ siteName, phone, logo: logoUrl,openingBalance,openingBalanceSet:true });
      await setting.save();
      res.status(201).json(setting);
    }
  } catch (error) {
    console.error('Save settings failed:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc Get settings
exports.getSettings = async (req, res) => {
  try {
    const setting = await Setting.findOne();
    res.json(setting);
  } catch (error) {
    console.error('Get settings failed:', error);
    res.status(500).json({ message: error.message });
  }
};