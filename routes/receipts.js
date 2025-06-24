const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const receiptController = require('../controllers/receiptController');

router.post('/', auth, receiptController.addReceipt);
router.get('/', auth, receiptController.getReceipts);
router.put('/:id', auth, receiptController.updateReceipt);
router.delete('/:id', auth, receiptController.deleteReceipt);
router.get('/recurring-suggestions', auth, receiptController.getRecurringSuggestions);

module.exports = router;