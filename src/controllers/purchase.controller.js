const purchaseService = require('../services/purchase.service');

async function myPurchases(req, res, next) {
  try {
    const purchases = await purchaseService.getMyPurchases(req.user.id);
    res.json(purchases);
  } catch (err) {
    next(err);
  }
}

async function sellerEarnings(req, res, next) {
  try {
    const earnings = await purchaseService.getSellerEarnings(req.user.id);
    res.json(earnings);
  } catch (err) {
    next(err);
  }
}

module.exports = { myPurchases, sellerEarnings };
