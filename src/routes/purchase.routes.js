const { Router } = require('express');
const controller = require('../controllers/purchase.controller');
const { authenticate } = require('../middleware/auth.middleware');

const router = Router();

// List my purchases
router.get('/my', authenticate, controller.myPurchases);

// List my earnings
router.get('/earnings', authenticate, controller.sellerEarnings);

module.exports = router;
