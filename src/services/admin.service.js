const jwt = require('jsonwebtoken');
const pool = require('../database/pool');
const config = require('../config');
const supabase = require('../config/supabase');
const { logAudit } = require('./audit.service');
const ADMIN_REVIEW_URL_EXPIRY_SECONDS = 600;

async function login({ adminId, password }) {
  if (adminId !== config.admin.id || password !== config.admin.password) {
    const err = new Error('Invalid admin credentials');
    err.status = 401;
    throw err;
  }

  const token = jwt.sign(
    { id: adminId, email: `${adminId}@admin.local`, role: 'admin' },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );

  await logAudit({
    actorType: 'admin',
    actorId: adminId,
    action: 'admin.login',
    metadata: { success: true },
  }).catch(() => {});

  return { token, admin: { id: adminId, role: 'admin' } };
}

async function listModerationQueue({ status = 'pending_review', page = 1, limit = 20 }) {
  const offset = (page - 1) * limit;
  const values = [];
  let whereClause = '';

  if (status && status !== 'all') {
    values.push(status);
    whereClause = `WHERE p.review_status = $${values.length}`;
  }

  values.push(limit);
  values.push(offset);

  const result = await pool.query(
    `SELECT p.id, p.title, p.author_name, p.description, p.price, p.mrp,
            p.review_status, p.rejection_reason, p.is_active, p.created_at,
            u.id AS seller_id, u.name AS seller_name, u.email AS seller_email
     FROM pdf_products p
     JOIN users u ON u.id = p.seller_id
     ${whereClause}
     ORDER BY p.created_at DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return result.rows;
}

async function approveProduct({ productId, adminId }) {
  const result = await pool.query(
    `UPDATE pdf_products
     SET review_status = 'approved',
         rejection_reason = NULL,
         reviewed_by = $2,
         reviewed_at = NOW(),
         is_active = true,
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, title, review_status`,
    [productId, adminId]
  );

  if (result.rows.length === 0) {
    const err = new Error('Product not found');
    err.status = 404;
    throw err;
  }

  await logAudit({
    actorType: 'admin',
    actorId: adminId,
    action: 'moderation.approve',
    targetType: 'pdf_product',
    targetId: productId,
  }).catch(() => {});

  return result.rows[0];
}

async function rejectProduct({ productId, adminId, reason }) {
  const trimmedReason = String(reason || '').trim();
  if (!trimmedReason) {
    const err = new Error('Rejection reason is required');
    err.status = 400;
    throw err;
  }

  const result = await pool.query(
    `UPDATE pdf_products
     SET review_status = 'rejected',
         rejection_reason = $3,
         reviewed_by = $2,
         reviewed_at = NOW(),
         is_active = false,
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, title, review_status, rejection_reason`,
    [productId, adminId, trimmedReason]
  );

  if (result.rows.length === 0) {
    const err = new Error('Product not found');
    err.status = 404;
    throw err;
  }

  await logAudit({
    actorType: 'admin',
    actorId: adminId,
    action: 'moderation.reject',
    targetType: 'pdf_product',
    targetId: productId,
    metadata: { reason: trimmedReason },
  }).catch(() => {});

  return result.rows[0];
}

async function listUsers({ page = 1, limit = 20, q = '' }) {
  const offset = (page - 1) * limit;
  const values = [];
  let whereClause = '';

  if (q && q.trim()) {
    values.push(`%${q.trim()}%`);
    whereClause = `WHERE u.email ILIKE $${values.length} OR u.name ILIKE $${values.length}`;
  }

  values.push(limit);
  values.push(offset);

  const result = await pool.query(
    `SELECT u.id, u.name, u.email, u.created_at, u.is_banned, u.ban_reason, u.banned_at,
            COALESCE(up.uploaded_count, 0) AS uploaded_count,
            COALESCE(so.sold_count, 0) AS sold_count,
            COALESCE(bu.bought_count, 0) AS bought_count
     FROM users u
     LEFT JOIN (
       SELECT seller_id, COUNT(*)::int AS uploaded_count
       FROM pdf_products
       GROUP BY seller_id
     ) up ON up.seller_id = u.id
     LEFT JOIN (
       SELECT p.seller_id, COUNT(*)::int AS sold_count
       FROM purchases pu
       JOIN pdf_products p ON p.id = pu.product_id
       WHERE pu.status = 'paid'
       GROUP BY p.seller_id
     ) so ON so.seller_id = u.id
     LEFT JOIN (
       SELECT buyer_id, COUNT(*)::int AS bought_count
       FROM purchases
       WHERE status = 'paid'
       GROUP BY buyer_id
     ) bu ON bu.buyer_id = u.id
     ${whereClause}
     ORDER BY u.created_at DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return result.rows;
}

async function getUserDetails(userId) {
  const userRes = await pool.query(
    `SELECT u.id, u.name, u.email, u.created_at, u.is_banned, u.ban_reason, u.banned_at, u.banned_by,
            COALESCE(up.uploaded_count, 0) AS uploaded_count,
            COALESCE(so.sold_count, 0) AS sold_count,
            COALESCE(bu.bought_count, 0) AS bought_count
     FROM users u
     LEFT JOIN (
       SELECT seller_id, COUNT(*)::int AS uploaded_count
       FROM pdf_products
       GROUP BY seller_id
     ) up ON up.seller_id = u.id
     LEFT JOIN (
       SELECT p.seller_id, COUNT(*)::int AS sold_count
       FROM purchases pu
       JOIN pdf_products p ON p.id = pu.product_id
       WHERE pu.status = 'paid'
       GROUP BY p.seller_id
     ) so ON so.seller_id = u.id
     LEFT JOIN (
       SELECT buyer_id, COUNT(*)::int AS bought_count
       FROM purchases
       WHERE status = 'paid'
       GROUP BY buyer_id
     ) bu ON bu.buyer_id = u.id
     WHERE u.id = $1`,
    [userId]
  );

  if (userRes.rows.length === 0) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  const uploadsRes = await pool.query(
    `SELECT id, title, author_name, price, mrp, review_status, rejection_reason, is_active, created_at
     FROM pdf_products
     WHERE seller_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );

  const downloadsRes = await pool.query(
    `SELECT pu.id AS purchase_id, pu.status, pu.amount, pu.created_at AS purchased_at,
            p.id AS product_id, p.title, p.author_name
     FROM purchases pu
     JOIN pdf_products p ON p.id = pu.product_id
     WHERE pu.buyer_id = $1 AND pu.status = 'paid'
     ORDER BY pu.created_at DESC`,
    [userId]
  );

  return {
    user: userRes.rows[0],
    uploaded_pdfs: uploadsRes.rows,
    downloaded_pdfs: downloadsRes.rows,
  };
}

async function listOrders({ page = 1, limit = 20, status = '' }) {
  const offset = (page - 1) * limit;
  const values = [];
  let whereClause = '';
  if (status && status.trim()) {
    values.push(status.trim());
    whereClause = `WHERE pu.status = $${values.length}`;
  }

  values.push(limit);
  values.push(offset);

  const result = await pool.query(
    `SELECT pu.id AS purchase_id, pu.status, pu.amount, pu.created_at,
            pu.razorpay_order_id, pu.razorpay_payment_id,
            p.id AS product_id, p.title AS product_title,
            buyer.id AS buyer_id, buyer.email AS buyer_email,
            seller.id AS seller_id, seller.email AS seller_email
     FROM purchases pu
     JOIN pdf_products p ON p.id = pu.product_id
     JOIN users buyer ON buyer.id = pu.buyer_id
     JOIN users seller ON seller.id = p.seller_id
     ${whereClause}
     ORDER BY pu.created_at DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return result.rows;
}

async function listAuditLogs({ page = 1, limit = 50 }) {
  const offset = (page - 1) * limit;
  const result = await pool.query(
    `SELECT id, actor_type, actor_id, action, target_type, target_id, metadata, created_at
     FROM audit_logs
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return result.rows;
}

async function getProductReviewUrl({ productId, adminId }) {
  const productRes = await pool.query(
    `SELECT id, file_path, title, seller_id, review_status
     FROM pdf_products
     WHERE id = $1`,
    [productId]
  );

  if (productRes.rows.length === 0) {
    const err = new Error('Product not found');
    err.status = 404;
    throw err;
  }

  const product = productRes.rows[0];
  const { data, error } = await supabase.storage
    .from(config.supabase.bucket)
    .createSignedUrl(product.file_path, ADMIN_REVIEW_URL_EXPIRY_SECONDS);

  if (error || !data?.signedUrl) {
    const err = new Error(`Failed to generate review URL: ${error?.message || 'unknown error'}`);
    err.status = 500;
    throw err;
  }

  await logAudit({
    actorType: 'admin',
    actorId: adminId,
    action: 'moderation.preview',
    targetType: 'pdf_product',
    targetId: productId,
    metadata: { review_status: product.review_status },
  }).catch(() => {});

  return {
    product_id: product.id,
    title: product.title,
    review_status: product.review_status,
    signed_url: data.signedUrl,
    expires_in: ADMIN_REVIEW_URL_EXPIRY_SECONDS,
  };
}

/**
 * Permanently delete a PDF product:
 *  1. Remove PDF file (and cover image) from Supabase storage.
 *  2. Delete DB record — purchases/earnings cascade automatically.
 *  3. Log audit entry.
 */
async function deleteProduct({ productId, adminId }) {
  // Fetch product to get storage paths
  const res = await pool.query(
    `SELECT id, title, file_path, cover_path, seller_id FROM pdf_products WHERE id = $1`,
    [productId]
  );
  if (res.rows.length === 0) {
    const err = new Error('Product not found');
    err.status = 404;
    throw err;
  }
  const product = res.rows[0];

  // Remove files from Supabase storage
  const pathsToRemove = [product.file_path].filter(Boolean);
  if (product.cover_path) pathsToRemove.push(product.cover_path);
  if (pathsToRemove.length > 0) {
    await supabase.storage.from(config.supabase.bucket).remove(pathsToRemove);
  }

  // Delete DB record (purchases, earnings cascade via ON DELETE CASCADE)
  await pool.query('DELETE FROM pdf_products WHERE id = $1', [productId]);

  await logAudit({
    actorType: 'admin',
    actorId: adminId,
    action: 'admin.delete_product',
    targetType: 'product',
    targetId: productId,
    metadata: { title: product.title, seller_id: product.seller_id },
  }).catch(() => {});

  return { deleted: true, product_id: productId, title: product.title };
}

async function listReports({ status = 'open', page = 1, limit = 50 }) {
  const offset = (page - 1) * limit;
  const values = [];
  let whereClause = '';

  if (status && status !== 'all') {
    values.push(status);
    whereClause = `WHERE r.status = $${values.length}`;
  }

  values.push(limit);
  values.push(offset);

  const result = await pool.query(
    `SELECT
       r.id, r.product_id, r.product_title, r.reason_code, r.custom_reason, r.status,
       r.admin_note, r.resolved_by, r.resolved_at, r.created_at,
       reporter.id AS reporter_id, reporter.email AS reporter_email,
       seller.id AS seller_id, seller.email AS seller_email, seller.is_banned AS seller_is_banned
     FROM pdf_reports r
     LEFT JOIN users reporter ON reporter.id = r.reporter_id
     LEFT JOIN users seller ON seller.id = r.seller_id
     ${whereClause}
     ORDER BY r.created_at DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return result.rows;
}

async function updateReportStatus({
  reportId,
  status,
  adminId,
  adminNote = '',
}) {
  const allowedStatuses = ['open', 'under_review', 'resolved', 'dismissed'];
  if (!allowedStatuses.includes(status)) {
    const err = new Error('Invalid report status');
    err.status = 400;
    throw err;
  }

  const trimmedNote = String(adminNote || '').trim();
  const shouldResolve = status === 'resolved' || status === 'dismissed';

  const result = await pool.query(
    `UPDATE pdf_reports
     SET status = $2,
         admin_note = CASE WHEN $3 = '' THEN admin_note ELSE $3 END,
         resolved_by = CASE WHEN $4 THEN $5 ELSE NULL END,
         resolved_at = CASE WHEN $4 THEN NOW() ELSE NULL END,
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, product_id, product_title, reason_code, custom_reason, status, admin_note, resolved_by, resolved_at, created_at`,
    [reportId, status, trimmedNote, shouldResolve, adminId]
  );

  if (result.rows.length === 0) {
    const err = new Error('Report not found');
    err.status = 404;
    throw err;
  }

  await logAudit({
    actorType: 'admin',
    actorId: adminId,
    action: 'report.status_update',
    targetType: 'pdf_report',
    targetId: reportId,
    metadata: { status, admin_note: trimmedNote || null },
  }).catch(() => {});

  return result.rows[0];
}

async function banUser({ userId, reason, adminId }) {
  const trimmedReason = String(reason || '').trim();
  if (trimmedReason.length < 3) {
    const err = new Error('Ban reason is required');
    err.status = 400;
    throw err;
  }

  const result = await pool.query(
    `UPDATE users
     SET is_banned = true,
         ban_reason = $2,
         banned_at = NOW(),
         banned_by = $3,
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, name, email, is_banned, ban_reason, banned_at, banned_by`,
    [userId, trimmedReason, adminId]
  );

  if (result.rows.length === 0) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  await pool.query(
    `UPDATE pdf_products
     SET is_active = false, updated_at = NOW()
     WHERE seller_id = $1`,
    [userId]
  );

  await logAudit({
    actorType: 'admin',
    actorId: adminId,
    action: 'admin.ban_user',
    targetType: 'user',
    targetId: userId,
    metadata: { reason: trimmedReason },
  }).catch(() => {});

  return result.rows[0];
}

async function unbanUser({ userId, adminId }) {
  const result = await pool.query(
    `UPDATE users
     SET is_banned = false,
         ban_reason = NULL,
         banned_at = NULL,
         banned_by = NULL,
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, name, email, is_banned`,
    [userId]
  );

  if (result.rows.length === 0) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  await logAudit({
    actorType: 'admin',
    actorId: adminId,
    action: 'admin.unban_user',
    targetType: 'user',
    targetId: userId,
  }).catch(() => {});

  return result.rows[0];
}

module.exports = {
  login,
  listModerationQueue,
  approveProduct,
  rejectProduct,
  listUsers,
  getUserDetails,
  listOrders,
  listAuditLogs,
  getProductReviewUrl,
  deleteProduct,
  listReports,
  updateReportStatus,
  banUser,
  unbanUser,
};
