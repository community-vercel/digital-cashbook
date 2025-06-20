const express = require('express');
const router = express.Router();
const receiptController = require('../controllers/receiptController');
const auth = require('../middleware/auth');

router.post('/', auth, receiptController.uploadReceiptImage, receiptController.createReceipt);
router.get('/', auth, receiptController.getReceipts);
// router.put('/:id', auth, receiptController.uploadReceiptImage, receiptController.updateReceipt);
// router.delete('/:id', auth, receiptController.deleteReceipt);

module.exports = router;