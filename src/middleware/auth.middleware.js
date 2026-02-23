/**
 * JWT authentication middleware.
 *
 * HOW IT WORKS:
 * 1. Client sends `Authorization: Bearer <token>` header.
 * 2. We verify the token using the shared JWT_SECRET.
 * 3. Decoded payload (id, email, role) is attached to `req.user`.
 * 4. Downstream controllers can trust req.user for identity.
 *
 * If the token is missing, expired, or tampered, we return 401.
 */
const jwt = require('jsonwebtoken');
const config = require('../config');

function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    req.user = decoded; // { id, email, iat, exp }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Role-based authorisation.
 * Usage: authorize('seller')  or  authorize('seller', 'buyer')
 */
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: insufficient role' });
    }
    next();
  };
}

function authorizeAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { authenticate, authorize, authorizeAdmin };
