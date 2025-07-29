const express = require('express');
const router = express.Router();
const transactionController = require('../controllers/transactionController');
const auth = require('../middleware/auth'); // Assuming you have authentication middleware

// Transaction routes
router.post('/', auth, transactionController.addTransaction);
router.get('/', auth, transactionController.getTransactions);
router.get('/user', auth, transactionController.getUserTransactions);
router.put('/:id', auth, transactionController.updateTransaction);
router.delete('/:id', auth, transactionController.deleteTransaction);
router.get('/recurring', auth, transactionController.getRecurringSuggestions);
router.get('/daily-report', auth, transactionController.getDailyReport);
router.get('/generate-pdf', auth, transactionController.generateDailyReportPdf);


module.exports = router;