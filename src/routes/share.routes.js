/**
 * Share / Deep-link landing page.
 *
 * When a seller shares a link like  http://<host>:5000/share/product/<id>
 * this route serves a minimal HTML page that:
 *   1. Tries to open the Flutter app via deep link (notebay://product/<id>)
 *   2. Shows product info (title, price, seller name, description) so the
 *      link preview looks good when shared on WhatsApp / Telegram / etc.
 *   3. Falls back to a "Download the app" message if the app isn't installed.
 */
const { Router } = require('express');
const pool = require('../database/pool');

const router = Router();

router.get('/product/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT p.id, p.title, p.description, p.price, u.name AS seller_name
       FROM pdf_products p
       JOIN users u ON u.id = p.seller_id
       WHERE p.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).send('<h1>Product not found</h1>');
    }

    const product = result.rows[0];
    const deepLink = `notebay://product/${product.id}`;
    const price = parseFloat(product.price).toFixed(0);

    // Serve a self-contained HTML page with OG meta tags for link previews
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${product.title} — NoteBay</title>

  <!-- Open Graph tags for rich link previews (WhatsApp, Telegram, etc.) -->
  <meta property="og:title" content="${product.title}" />
  <meta property="og:description" content="${product.description || 'Buy this PDF on NoteBay app'} — ₹${price} by ${product.seller_name}" />
  <meta property="og:type" content="product" />
  <meta property="og:url" content="${req.protocol}://${req.get('host')}/share/product/${product.id}" />

  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1565C0 0%, #0D47A1 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 32px;
      max-width: 420px;
      width: 100%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      text-align: center;
    }
    .pdf-icon { font-size: 64px; margin-bottom: 16px; }
    h1 { font-size: 24px; color: #1a1a1a; margin-bottom: 8px; }
    .seller { font-size: 14px; color: #666; margin-bottom: 12px; }
    .description { font-size: 15px; color: #444; margin-bottom: 20px; line-height: 1.5; }
    .price {
      font-size: 32px; font-weight: 700; color: #1565C0;
      margin-bottom: 24px;
    }
    .btn {
      display: inline-block;
      background: #1565C0;
      color: white;
      text-decoration: none;
      padding: 14px 32px;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      transition: background 0.2s;
    }
    .btn:hover { background: #0D47A1; }
    .fallback {
      margin-top: 16px;
      font-size: 13px;
      color: #888;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="pdf-icon">📄</div>
    <h1>${product.title}</h1>
    <p class="seller">by ${product.seller_name}</p>
    ${product.description ? `<p class="description">${product.description}</p>` : ''}
    <div class="price">₹${price}</div>
    <a class="btn" id="openApp" href="${deepLink}">Open in App</a>
    <p class="fallback">If the app doesn't open, make sure "NoteBay" is installed on your device.</p>
  </div>

  <script>
    // Try to open the app automatically via deep link
    window.onload = function() {
      window.location.href = '${deepLink}';
    };
  </script>
</body>
</html>`);
  } catch (err) {
    console.error('Share page error:', err);
    res.status(500).send('<h1>Something went wrong</h1>');
  }
});

module.exports = router;
