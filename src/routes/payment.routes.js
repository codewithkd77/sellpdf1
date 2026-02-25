const { Router } = require('express');
const controller = require('../controllers/payment.controller');
const { authenticate } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const { createOrderSchema } = require('../validators/payment.validator');

const router = Router();

// Create a Razorpay order (any authenticated user)
router.post(
  '/create-order',
  authenticate,
  validate(createOrderSchema),
  controller.createOrder
);

// Client-side payment verification (mobile app calls this after checkout)
router.post('/verify', authenticate, controller.verifyPayment);

// Razorpay webhook — no auth (verified via HMAC signature)
router.post('/webhook', controller.webhook);

module.exports = router;
