const express = require('express');
const router = express.Router();
const settingController = require('../controllers/settingController');

// POST and GET routes
router.post('/', settingController.saveSettings);
router.get('/', settingController.getSettings);

module.exports = router;
