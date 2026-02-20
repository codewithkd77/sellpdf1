/**
 * Centralised error-handling middleware.
 */

function notFound(req, res, _next) {
  res.status(404).json({ error: `Route ${req.originalUrl} not found` });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, _req, res, _next) {
  console.error('Unhandled error:', err);

  const status = err.status || 500;
  const isProd = process.env.NODE_ENV === 'production';
  const message = isProd
    ? (status < 500 ? err.message || 'Request failed' : 'Internal server error')
    : err.message || 'Internal server error';

  res.status(status).json({ error: message });
}

module.exports = { notFound, errorHandler };
