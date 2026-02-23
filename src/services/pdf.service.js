/**
 * PDF service — upload, retrieve, and signed-URL access.
 *
 * SUPABASE UPLOAD FLOW:
 * 1. Seller uploads a PDF via multipart/form-data.
 * 2. Multer stores it temporarily in memory (memoryStorage).
 * 3. We upload the buffer to Supabase private bucket under
 *    path "pdfs/<seller_id>/<uuid>.pdf".
 * 4. The file_path is stored in the pdf_products table.
 *
 * SIGNED URL LOGIC:
 * - The bucket is PRIVATE — no public URLs exist.
 * - When a buyer who has purchased the product requests access,
 *   we generate a signed URL with a 5-minute expiry.
 * - The signed URL is a time-limited pre-authenticated link
 *   that Supabase CDN honours. After expiry it returns 403.
 * - This prevents hotlinking and unauthorised redistribution.
 */
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const pool = require('../database/pool');
const supabase = require('../config/supabase');
const config = require('../config');

const SIGNED_URL_EXPIRY_SECONDS = 300; // 5 minutes
const COVER_SIGNED_URL_EXPIRY_SECONDS = 86400; // 24 hours
const MAX_PRODUCTS_PER_SELLER = 10;

const IMAGE_MIME_EXTENSION = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Generate a unique 6-character alphanumeric code (uppercase).
 * Example: "A3F9K2"
 */
function generateShortCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid confusion
  let code = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

/**
 * Upload a PDF and create a product record.
 */
async function createProduct({
  sellerId,
  title,
  authorName,
  description,
  mrp = null,
  price,
  allowDownload,
  file,
  coverFile = null,
}) {
  const normalizedAuthorName = String(authorName || '').trim();
  if (!normalizedAuthorName || normalizedAuthorName.length < 2) {
    const err = new Error('Author name is required');
    err.status = 400;
    throw err;
  }

  if (Number.isNaN(price) || price < 0) {
    const err = new Error('Invalid discounted price');
    err.status = 400;
    throw err;
  }

  const normalizedMrp = mrp == null || Number.isNaN(mrp) ? null : mrp;
  if (normalizedMrp != null && normalizedMrp < price) {
    const err = new Error('MRP must be greater than or equal to discounted price');
    err.status = 400;
    throw err;
  }

  const countRes = await pool.query(
    'SELECT COUNT(*)::int AS total FROM pdf_products WHERE seller_id = $1',
    [sellerId]
  );
  const totalProducts = countRes.rows[0]?.total || 0;
  if (totalProducts >= MAX_PRODUCTS_PER_SELLER) {
    const err = new Error('You can upload a maximum of 10 PDFs per account');
    err.status = 400;
    throw err;
  }

  // 1. Upload to Supabase storage
  const fileExt = 'pdf';
  const storagePath = `${sellerId}/${uuidv4()}.${fileExt}`;

  const { error: uploadError } = await supabase.storage
    .from(config.supabase.bucket)
    .upload(storagePath, file.buffer, {
      contentType: 'application/pdf',
      upsert: false,
    });

  if (uploadError) {
    const err = new Error(`Storage upload failed: ${uploadError.message}`);
    err.status = 500;
    throw err;
  }

  // 2. Optional cover upload
  let coverPath = null;
  if (coverFile) {
    const coverExt = IMAGE_MIME_EXTENSION[coverFile.mimetype] || 'jpg';
    coverPath = `${sellerId}/covers/${uuidv4()}.${coverExt}`;

    const { error: coverUploadError } = await supabase.storage
      .from(config.supabase.bucket)
      .upload(coverPath, coverFile.buffer, {
        contentType: coverFile.mimetype,
        upsert: false,
      });

    if (coverUploadError) {
      // Remove uploaded PDF to avoid orphan files when cover upload fails.
      await supabase.storage.from(config.supabase.bucket).remove([storagePath]);
      const err = new Error(`Cover upload failed: ${coverUploadError.message}`);
      err.status = 500;
      throw err;
    }
  }

  // 3. Generate a unique short code (retry on collision)
  let shortCode;
  let attempts = 0;
  while (attempts < 10) {
    shortCode = generateShortCode();
    const exists = await pool.query(
      'SELECT 1 FROM pdf_products WHERE short_code = $1',
      [shortCode]
    );
    if (exists.rows.length === 0) break;
    attempts++;
  }

  // 4. Insert product record
  const result = await pool.query(
    `INSERT INTO pdf_products (seller_id, short_code, title, author_name, description, mrp, price, allow_download, file_path, cover_path, file_size, review_status, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending_review', false)
     RETURNING *`,
    [
      sellerId,
      shortCode,
      title,
      normalizedAuthorName,
      description,
      normalizedMrp,
      price,
      allowDownload,
      storagePath,
      coverPath,
      file.size,
    ]
  );

  return attachCoverUrl(result.rows[0]);
}

async function createCoverSignedUrl(coverPath) {
  const { data, error } = await supabase.storage
    .from(config.supabase.bucket)
    .createSignedUrl(coverPath, COVER_SIGNED_URL_EXPIRY_SECONDS);

  if (error) {
    return null;
  }
  return data?.signedUrl || null;
}

async function attachCoverUrl(product) {
  if (!product) return product;
  if (!product.cover_path) {
    return { ...product, cover_url: null };
  }
  const coverUrl = await createCoverSignedUrl(product.cover_path);
  return { ...product, cover_url: coverUrl };
}

async function attachCoverUrls(products) {
  return Promise.all(products.map((product) => attachCoverUrl(product)));
}

/**
 * Get a single product by ID (public metadata — no file access).
 */
async function getProductById(productId) {
  const result = await pool.query(
    `SELECT p.*, u.name AS seller_name
     FROM pdf_products p
     JOIN users u ON u.id = p.seller_id
     WHERE p.id = $1
       AND p.is_active = true
       AND p.review_status = 'approved'`,
    [productId]
  );

  if (result.rows.length === 0) {
    const err = new Error('Product not found');
    err.status = 404;
    throw err;
  }

  return attachCoverUrl(result.rows[0]);
}

/**
 * Find product by short code (for manual code entry).
 */
async function getProductByCode(shortCode) {
  const result = await pool.query(
    `SELECT p.*, u.name AS seller_name
     FROM pdf_products p
     JOIN users u ON u.id = p.seller_id
     WHERE UPPER(p.short_code) = UPPER($1)
       AND p.is_active = true
       AND p.review_status = 'approved'`,
    [shortCode]
  );

  if (result.rows.length === 0) {
    const err = new Error('No product found with that code');
    err.status = 404;
    throw err;
  }

  return attachCoverUrl(result.rows[0]);
}

/**
 * List all products (for marketplace browse).
 */
async function listProducts({ page = 1, limit = 20 }) {
  const offset = (page - 1) * limit;
  const result = await pool.query(
    `SELECT p.id, p.short_code, p.title, p.author_name, p.description, p.price, p.allow_download, p.cover_path,
            p.mrp,
            p.created_at, u.name AS seller_name
     FROM pdf_products p
     JOIN users u ON u.id = p.seller_id
     WHERE p.is_active = true
       AND p.review_status = 'approved'
     ORDER BY p.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return attachCoverUrls(result.rows);
}

/**
 * Search products by title, description, or code.
 */
async function searchProducts(query) {
  const searchTerm = `%${query}%`;
  const result = await pool.query(
    `SELECT p.id, p.short_code, p.title, p.author_name, p.description, p.price, p.allow_download, p.cover_path,
            p.mrp,
            p.created_at, u.name AS seller_name
     FROM pdf_products p
     JOIN users u ON u.id = p.seller_id
     WHERE p.is_active = true
       AND p.review_status = 'approved'
       AND (
           UPPER(p.title) LIKE UPPER($1)
        OR UPPER(p.description) LIKE UPPER($1)
        OR UPPER(p.short_code) LIKE UPPER($1)
       )
     ORDER BY p.created_at DESC`,
    [searchTerm]
  );
  return attachCoverUrls(result.rows);
}

/**
 * List products by a specific seller.
 */
async function listSellerProducts(sellerId) {
  const result = await pool.query(
    `SELECT * FROM pdf_products
     WHERE seller_id = $1
     ORDER BY created_at DESC`,
    [sellerId]
  );
  return attachCoverUrls(result.rows);
}

/**
 * Generate a signed URL for an authorised buyer.
 *
 * IMPORTANT: This must only be called after verifying the buyer
 * has a paid purchase for this product.
 */
async function getSignedUrl(productId, buyerId) {
  // 1. Verify purchase exists and is paid
  const purchase = await pool.query(
    `SELECT id FROM purchases
     WHERE buyer_id = $1 AND product_id = $2 AND status = 'paid'`,
    [buyerId, productId]
  );

  if (purchase.rows.length === 0) {
    const err = new Error('Purchase not found or not paid');
    err.status = 403;
    throw err;
  }

  // 2. Get product file_path and allow_download
  const product = await pool.query(
    'SELECT file_path, allow_download FROM pdf_products WHERE id = $1',
    [productId]
  );

  if (product.rows.length === 0) {
    const err = new Error('Product not found');
    err.status = 404;
    throw err;
  }

  const { file_path, allow_download } = product.rows[0];

  // 3. Generate signed URL (5-minute expiry)
  const { data, error } = await supabase.storage
    .from(config.supabase.bucket)
    .createSignedUrl(file_path, SIGNED_URL_EXPIRY_SECONDS);

  if (error) {
    const err = new Error(`Signed URL generation failed: ${error.message}`);
    err.status = 500;
    throw err;
  }

  return {
    signed_url: data.signedUrl,
    expires_in: SIGNED_URL_EXPIRY_SECONDS,
    allow_download,
  };
}

/**
 * Delete a product listing (only by the seller who owns it).
 * Also deletes the PDF file from Supabase storage.
 */
async function deleteProduct(productId, sellerId) {
  // 1. Verify the seller owns this product
  const product = await pool.query(
    'SELECT id, file_path, cover_path FROM pdf_products WHERE id = $1 AND seller_id = $2',
    [productId, sellerId]
  );

  if (product.rows.length === 0) {
    const err = new Error('Product not found or you do not own it');
    err.status = 404;
    throw err;
  }

  // 2. Check if there are paid purchases.
  const paidRes = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM purchases
     WHERE product_id = $1 AND status = 'paid'`,
    [productId]
  );
  const paidCount = paidRes.rows[0]?.total || 0;

  // 3A. If paid purchases exist -> soft delete (unlist only).
  if (paidCount > 0) {
    await pool.query(
      `UPDATE pdf_products
       SET is_active = false,
           updated_at = NOW()
       WHERE id = $1`,
      [productId]
    );
    return {
      message: 'Product removed from marketplace. Existing buyers keep access.',
      soft_deleted: true,
    };
  }

  // 3B. No paid purchases -> hard delete DB row + storage files.
  const filePaths = [product.rows[0].file_path];
  if (product.rows[0].cover_path) {
    filePaths.push(product.rows[0].cover_path);
  }

  await pool.query('DELETE FROM pdf_products WHERE id = $1', [productId]);

  const { error } = await supabase.storage
    .from(config.supabase.bucket)
    .remove(filePaths);

  if (error) {
    console.error('Failed to delete file from storage:', error.message);
    // Do not throw: DB delete already succeeded.
  }

  return { message: 'Product deleted permanently', soft_deleted: false };
}

/**
 * Update the price of a product (only by the seller who owns it).
 */
async function updatePrice(productId, sellerId, newPrice) {
  // 1. Verify the seller owns this product
  const product = await pool.query(
    'SELECT id FROM pdf_products WHERE id = $1 AND seller_id = $2',
    [productId, sellerId]
  );

  if (product.rows.length === 0) {
    const err = new Error('Product not found or you do not own it');
    err.status = 404;
    throw err;
  }

  // 2. Validate price
  if (newPrice < 0) {
    const err = new Error('Price cannot be negative');
    err.status = 400;
    throw err;
  }

  // 3. Update the price
  const result = await pool.query(
    'UPDATE pdf_products SET price = $1 WHERE id = $2 RETURNING *',
    [newPrice, productId]
  );

  return attachCoverUrl(result.rows[0]);
}

/**
 * Update product metadata (seller-only).
 */
async function updateProductDetails(
  productId,
  sellerId,
  { title, authorName, description, mrp, price, allowDownload, coverFile }
) {
  const existingRes = await pool.query(
    `SELECT id, title, author_name, description, mrp, price, allow_download, cover_path
     FROM pdf_products
     WHERE id = $1 AND seller_id = $2`,
    [productId, sellerId]
  );

  if (existingRes.rows.length === 0) {
    const err = new Error('Product not found or you do not own it');
    err.status = 404;
    throw err;
  }

  const existing = existingRes.rows[0];
  const nextTitle = title !== undefined ? String(title).trim() : existing.title;
  const nextAuthorName =
    authorName !== undefined ? String(authorName).trim() : existing.author_name;
  const nextDescription = description !== undefined ? (description || null) : existing.description;
  const nextPrice = price !== undefined ? price : parseFloat(existing.price);
  const nextMrp = mrp !== undefined ? mrp : (existing.mrp != null ? parseFloat(existing.mrp) : null);
  const nextAllowDownload =
    allowDownload !== undefined ? allowDownload : existing.allow_download;

  if (!nextTitle || nextTitle.length < 3) {
    const err = new Error('Title must be at least 3 characters');
    err.status = 400;
    throw err;
  }
  if (authorName !== undefined && (!nextAuthorName || nextAuthorName.length < 2)) {
    const err = new Error('Author name is required');
    err.status = 400;
    throw err;
  }
  if (Number.isNaN(nextPrice) || nextPrice < 0) {
    const err = new Error('Invalid discounted price');
    err.status = 400;
    throw err;
  }
  if (nextMrp != null && (Number.isNaN(nextMrp) || nextMrp < 0)) {
    const err = new Error('Invalid MRP');
    err.status = 400;
    throw err;
  }
  if (nextMrp != null && nextMrp < nextPrice) {
    const err = new Error('MRP must be greater than or equal to discounted price');
    err.status = 400;
    throw err;
  }

  let nextCoverPath = existing.cover_path;
  if (coverFile) {
    const coverExt = IMAGE_MIME_EXTENSION[coverFile.mimetype] || 'jpg';
    const uploadedCoverPath = `${sellerId}/covers/${uuidv4()}.${coverExt}`;
    const { error: coverUploadError } = await supabase.storage
      .from(config.supabase.bucket)
      .upload(uploadedCoverPath, coverFile.buffer, {
        contentType: coverFile.mimetype,
        upsert: false,
      });

    if (coverUploadError) {
      const err = new Error(`Cover upload failed: ${coverUploadError.message}`);
      err.status = 500;
      throw err;
    }
    nextCoverPath = uploadedCoverPath;
  }

  const result = await pool.query(
    `UPDATE pdf_products
     SET title = $1,
         author_name = $2,
         description = $3,
         mrp = $4,
         price = $5,
         allow_download = $6,
         cover_path = $7,
         review_status = 'pending_review',
         rejection_reason = NULL,
         reviewed_by = NULL,
         reviewed_at = NULL,
         is_active = false,
         updated_at = NOW()
     WHERE id = $8
     RETURNING *`,
    [
      nextTitle,
      nextAuthorName,
      nextDescription,
      nextMrp,
      nextPrice,
      nextAllowDownload,
      nextCoverPath,
      productId,
    ]
  );

  if (coverFile && existing.cover_path && existing.cover_path !== nextCoverPath) {
    await supabase.storage.from(config.supabase.bucket).remove([existing.cover_path]);
  }

  return attachCoverUrl(result.rows[0]);
}

module.exports = {
  createProduct,
  getProductById,
  getProductByCode,
  listProducts,
  searchProducts,
  listSellerProducts,
  getSignedUrl,
  deleteProduct,
  updatePrice,
  updateProductDetails,
};
