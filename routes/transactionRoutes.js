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
const validateObjectId = (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: 'Invalid transaction ID' });
  }
  next();
};

// GET /transactions/:id - Retrieve a specific transaction
router.get('/:id', authMiddleware, validateObjectId, async (req, res) => {
  try {
    const { id } = req.params;
    const { role, shopId, userId } = req.user; // From authMiddleware

    // Build query
    let query = { _id: id };

    // Restrict to user's shop for non-superadmin
    if (role !== 'superadmin') {
      if (!shopId) {
        return res.status(403).json({ message: 'No shop assigned to user' });
      }
      query.shopId = shopId;
    }

    // Find transaction and populate related fields
    const transaction = await Transaction.findOne(query)
      .populate('customerId', 'name phone') // Populate customer details
      .populate('userId', 'name email') // Populate user details
      .populate('shopId', 'name'); // Populate shop details

    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    res.status(200).json({ data: transaction });
  } catch (error) {
    console.error('Error fetching transaction:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;