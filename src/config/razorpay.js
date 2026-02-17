/**
 * Razorpay SDK instance (test mode in dev).
 */
const Razorpay = require('razorpay');
const config = require('../config');

const razorpay = new Razorpay({
  key_id: config.razorpay.keyId,
  key_secret: config.razorpay.keySecret,
});

module.exports = razorpay;
