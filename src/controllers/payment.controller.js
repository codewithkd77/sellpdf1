const paymentService = require('../services/payment.service');

/**
 * POST /api/payment/create-order
 * Authenticated buyer creates a Razorpay order.
 */
async function createOrder(req, res, next) {
  try {
    const data = await paymentService.createOrder({
      buyerId: req.user.id,
      productId: req.body.product_id,
    });
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/payment/webhook
 *
 * Called by Razorpay servers — NOT by our frontend.
 * Body arrives as raw Buffer because we used express.raw()
 * on this specific route in app.js.
 */
async function webhook(req, res, next) {
  try {
    const signature = req.headers['x-razorpay-signature'];
    if (!signature) {
      return res.status(400).json({ error: 'Missing signature header' });
    }

    const result = await paymentService.handleWebhook(req.body, signature);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/payment/verify
 * Called by the mobile app after Razorpay checkout succeeds.
 */
async function verifyPayment(req, res, next) {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing payment fields' });
    }
    const result = await paymentService.verifyPayment({
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = { createOrder, webhook, verifyPayment };
