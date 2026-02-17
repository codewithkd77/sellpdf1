const pool = require('../database/pool');

/**
 * Get all purchases for a buyer, with product details.
 */
async function getMyPurchases(buyerId) {
  const result = await pool.query(
    `SELECT pu.id AS purchase_id, pu.status, pu.amount, pu.created_at,
            p.id AS product_id, p.title, p.description, p.allow_download,
            u.name AS seller_name
     FROM purchases pu
     JOIN pdf_products p ON p.id = pu.product_id
     JOIN users u ON u.id = p.seller_id
     WHERE pu.buyer_id = $1
     ORDER BY pu.created_at DESC`,
    [buyerId]
  );
  return result.rows;
}

/**
 * Get seller earnings summary.
 */
async function getSellerEarnings(sellerId) {
  const result = await pool.query(
    `SELECT e.*, p.title AS product_title
     FROM earnings e
     JOIN pdf_products p ON p.id = (
       SELECT product_id FROM purchases WHERE id = e.purchase_id
     )
     WHERE e.seller_id = $1
     ORDER BY e.created_at DESC`,
    [sellerId]
  );
  return result.rows;
}

module.exports = { getMyPurchases, getSellerEarnings };
