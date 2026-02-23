/**
 * Express application factory.
 *
 * Separating app from server.js makes it testable without
 * actually listening on a port.
 */
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const authRoutes = require('./routes/auth.routes');
const pdfRoutes = require('./routes/pdf.routes');
const paymentRoutes = require('./routes/payment.routes');
const purchaseRoutes = require('./routes/purchase.routes');
const shareRoutes = require('./routes/share.routes');
const userRoutes = require('./routes/user.routes');
const adminRoutes = require('./routes/admin.routes');
const linkingRoutes = require('./routes/linking.routes');
const { errorHandler, notFound } = require('./middleware/error.middleware');

const app = express();

// ── Global middleware ────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));

// Razorpay webhook needs the raw body for HMAC verification,
// so we conditionally apply JSON parsing.
app.use('/api/payment/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// ── Routes ───────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/pdf', pdfRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/purchase', purchaseRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/.well-known', linkingRoutes);
app.use('/', linkingRoutes);

// Share / deep-link landing page (serves HTML, not JSON)
app.use('/share', shareRoutes);

// ── Error handling ───────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

module.exports = app;
