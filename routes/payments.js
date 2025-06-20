const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const auth = require('../middleware/auth');

router.post('/', auth, paymentController.createPayment);
router.get('/', auth, paymentController.getPayments);
router.put('/:id', auth, paymentController.updatePayment);
router.delete('/:id', auth, paymentController.deletePayment);
router.get('/recurring-suggestions', auth, paymentController.getRecurringSuggestions);

module.exports = router;