const express = require('express');
const router = express.Router();
const settingController = require('../controllers/settingController');
const authMiddleware = require('../middleware/auth');

// POST and GET routes - both now have auth middleware
router.post('/', authMiddleware, settingController.saveSettings);
router.get('/', authMiddleware, settingController.getSettings);

module.exports = router;