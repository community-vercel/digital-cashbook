// backend/routes/auth.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const jwt = require('jsonwebtoken');

const verifySuperadmin = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.error('No token provided or invalid Authorization header:', authHeader);
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.replace('Bearer ', '');
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('Decoded token:', { userId: decoded.userId, role: decoded.role, shopId: decoded.shopId });
    if (decoded.role !== 'superadmin') {
      console.error('Superadmin access required, user role:', decoded.role);
      return res.status(403).json({ error: 'Superadmin access required' });
    }
    req.user = decoded;
    next();
  } catch (error) {
    console.error('Invalid token error:', error.message);
    res.status(401).json({ error: 'Invalid token', details: error.message });
  }
};

router.post('/register', verifySuperadmin, authController.register);
router.post('/login', authController.login);
router.get('/validate-token', authController.validateToken);

module.exports = router;