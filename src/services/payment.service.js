/**
 * Payment service — Razorpay order creation + webhook processing.
 *
 * ═══════════════════════════════════════════════════════════════
 * WEBHOOK VERIFICATION (CRITICAL SECURITY)
 * ═══════════════════════════════════════════════════════════════
 *
 * Razorpay sends a POST to /api/payment/webhook after payment.
 * The request includes an `X-Razorpay-Signature` header which is
 * an HMAC-SHA256 of the raw body using your Webhook Secret.
 *
 * Verification steps:
 *   1. Compute HMAC-SHA256(rawBody, RAZORPAY_WEBHOOK_SECRET).
 *   2. Compare the result with the signature header.
 *   3. If they match → the payload is authentic & untampered.
 *   4. If not → reject with 400 (possible replay / forgery).
 *
 * WHY WEBHOOK-ONLY VERIFICATION?
 *   Client-side payment "success" callbacks can be faked.
 *   The webhook is a server-to-server call from Razorpay,
 *   which is far more trustworthy. We mark the purchase as
 *   "paid" ONLY when the webhook confirms it.
 *
 * ═══════════════════════════════════════════════════════════════
 * COMMISSION CALCULATION
 * ═══════════════════════════════════════════════════════════════
 *
 *   total_amount   = product price (what buyer pays)
 *   platform_fee   = total_amount × PLATFORM_COMMISSION_RATE (10%)
 *   seller_amount  = total_amount − platform_fee             (90%)
 *
 * Both amounts are stored in the `earnings` table per purchase,
 * creating an auditable ledger.
 * ═══════════════════════════════════════════════════════════════
 */
const crypto = require('crypto');
const pool = require('../database/pool');
const razorpay = require('../config/razorpay');
const config = require('../config');

/**
 * Create a Razorpay order and a pending purchase record.
 */
async function createOrder({ buyerId, productId }) {
  // 1. Fetch product
  const productRes = await pool.query(
    'SELECT id, seller_id, price FROM pdf_products WHERE id = $1',
    [productId]
  );

  if (productRes.rows.length === 0) {
    const err = new Error('Product not found');
    err.status = 404;
    throw err;
  }

  const product = productRes.rows[0];

  // Prevent buying own product
  if (product.seller_id === buyerId) {
    const err = new Error('You cannot purchase your own product');
    err.status = 400;
    throw err;
  }

  // 2. Check for existing paid purchase (prevent duplicates)
  const existingPurchase = await pool.query(
    `SELECT id, status FROM purchases
     WHERE buyer_id = $1 AND product_id = $2`,
    [buyerId, productId]
  );

  if (existingPurchase.rows.length > 0) {
    const existing = existingPurchase.rows[0];
    if (existing.status === 'paid') {
      const err = new Error('You have already purchased this product');
      err.status = 409;
      throw err;
    }
    // If a pending/failed order exists, delete it so we can create a new one
    await pool.query('DELETE FROM purchases WHERE id = $1', [existing.id]);
  }

  // 3. Handle free PDFs (price = 0) - auto-complete purchase
  // Convert to number since PostgreSQL returns decimals as strings
  const price = parseFloat(product.price);
  if (price === 0) {
    // Insert purchase record as paid and get the purchase ID
    const purchaseRes = await pool.query(
      `INSERT INTO purchases (buyer_id, product_id, amount, status)
       VALUES ($1, $2, $3, 'paid')
       RETURNING id`,
      [buyerId, productId, 0]
    );
    const purchaseId = purchaseRes.rows[0].id;

    // Create earnings record for the seller (commission = 0 for free PDFs)
    await pool.query(
      `INSERT INTO earnings (purchase_id, seller_id, total_amount, platform_fee, seller_amount)
       VALUES ($1, $2, $3, $4, $5)`,
      [purchaseId, product.seller_id, 0, 0, 0]
    );

    return {
      free: true,
      message: 'Free PDF acquired successfully',
    };
  }

  // 4. Create Razorpay order for paid PDFs (amount in paise)
  const amountPaise = Math.round(price * 100);
  const order = await razorpay.orders.create({
    amount: amountPaise,
    currency: 'INR',
    receipt: `rcpt_${productId}_${Date.now()}`,
    notes: {
      product_id: productId,
      buyer_id: buyerId,
    },
  });

  // 4. Insert pending purchase
  await pool.query(
    `INSERT INTO purchases (buyer_id, product_id, razorpay_order_id, amount, status)
     VALUES ($1, $2, $3, $4, 'pending')`,
    [buyerId, productId, order.id, price]
  );

  return {
    order_id: order.id,
    amount: amountPaise,
    currency: 'INR',
    key: config.razorpay.keyId,
  };
}

/**
 * Handle Razorpay webhook event.
 *
 * @param {Buffer} rawBody  — raw request body (needed for HMAC)
 * @param {string} signature — X-Razorpay-Signature header
 */
async function handleWebhook(rawBody, signature) {
  // ── Step 1: Verify signature ───────────────────────────────
  const expectedSig = crypto
    .createHmac('sha256', config.razorpay.webhookSecret)
    .update(rawBody)
    .digest('hex');

  if (expectedSig !== signature) {
    const err = new Error('Invalid webhook signature');
    err.status = 400;
    throw err;
  }

  // ── Step 2: Parse payload ──────────────────────────────────
  const event = JSON.parse(rawBody.toString());

  if (event.event !== 'payment.captured') {
    // We only care about captured (successful) payments
    return { status: 'ignored', event: event.event };
  }

  const payment = event.payload.payment.entity;
  const orderId = payment.order_id;
  const paymentId = payment.id;

  // ── Step 3: Update purchase → paid ─────────────────────────
  const purchaseRes = await pool.query(
    `UPDATE purchases
     SET    status = 'paid',
            razorpay_payment_id = $1,
            updated_at = NOW()
     WHERE  razorpay_order_id = $2 AND status = 'pending'
     RETURNING id, product_id, amount`,
    [paymentId, orderId]
  );

  if (purchaseRes.rows.length === 0) {
    // Already processed or unknown order — idempotent
    return { status: 'already_processed' };
  }

  const purchase = purchaseRes.rows[0];

  // ── Step 4: Compute commission & store in earnings ─────────
  const totalAmount = parseFloat(purchase.amount);
  const platformFee = +(totalAmount * config.platform.commissionRate).toFixed(2);
  const sellerAmount = +(totalAmount - platformFee).toFixed(2);

  // Find seller
  const productRes = await pool.query(
    'SELECT seller_id FROM pdf_products WHERE id = $1',
    [purchase.product_id]
  );
  const sellerId = productRes.rows[0].seller_id;

  await pool.query(
    `INSERT INTO earnings (purchase_id, seller_id, total_amount, platform_fee, seller_amount)
     VALUES ($1, $2, $3, $4, $5)`,
    [purchase.id, sellerId, totalAmount, platformFee, sellerAmount]
  );

  return { status: 'success', purchase_id: purchase.id };
}

module.exports = { createOrder, handleWebhook };
