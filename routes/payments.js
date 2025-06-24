const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const paymentController = require('../controllers/paymentController');

router.post('/', auth, paymentController.addPayment);
router.get('/', auth, paymentController.getPayments);
router.put('/:id', auth, paymentController.updatePayment);
router.delete('/:id', auth, paymentController.deletePayment);
router.get('/recurring-suggestions', auth, paymentController.getRecurringSuggestions);
module.exports = router;