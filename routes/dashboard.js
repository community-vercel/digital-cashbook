const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const auth = require('../middleware/auth');

router.get('/summary', auth, dashboardController.getDashboardData);

module.exports = router;