
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const customerController = require('../controllers/customerController');

router.post('/', auth, customerController.addCustomer);
router.get('/', auth, customerController.getCustomers);
router.post('/find-or-create', auth, customerController.getCustomerByNameOrPhone);

router.delete('/:id', auth, customerController.deleteCustomer);

module.exports = router;