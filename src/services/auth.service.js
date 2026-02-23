/**
 * Auth service — handles user registration and login.
 *
 * SECURITY NOTES:
 * - Passwords are hashed with bcrypt (cost factor 12).
 * - JWT carries only { id, email, role } — no sensitive data.
 * - Token expiry is configurable via JWT_EXPIRES_IN.
 */
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const pool = require('../database/pool');
const config = require('../config');

const SALT_ROUNDS = 12;
const googleClient = new OAuth2Client();

/**
 * Register a new user.
 * @returns {{ user, token }}
 */
async function register({ name, email, password }) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const duplicateEmailMessage =
    'This email is already used. Please log in or use another email instead.';

  // Block duplicate verified accounts.
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
  if (existing.rows.length > 0) {
    const err = new Error(duplicateEmailMessage);
    err.status = 409;
    throw err;
  }

  if (!name || name.trim().length < 2) {
    const err = new Error('Name is required');
    err.status = 400;
    throw err;
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const result = await pool.query(
    `INSERT INTO users (name, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, name, email, created_at`,
    [name.trim(), normalizedEmail, passwordHash]
  );

  const user = { ...result.rows[0], role: 'user' };
  const token = _generateToken(user);
  return { user, token };
}

/**
 * Login an existing user.
 * @returns {{ user, token }}
 */
async function login({ email, password }) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const result = await pool.query(
    'SELECT id, name, email, password_hash FROM users WHERE email = $1',
    [normalizedEmail]
  );

  if (result.rows.length === 0) {
    const err = new Error('Invalid email or password');
    err.status = 401;
    throw err;
  }

  const user = result.rows[0];
  const valid = await bcrypt.compare(password, user.password_hash);

  if (!valid) {
    const err = new Error('Invalid email or password');
    err.status = 401;
    throw err;
  }

  // Strip password_hash before returning
  delete user.password_hash;
  user.role = 'user';
  const token = _generateToken(user);

  return { user, token };
}

/**
 * Google Sign-In login.
 * Verifies Google ID token, then returns local app JWT.
 */
async function googleLogin({ idToken }) {
  const audience = [config.google.webClientId, config.google.mobileClientId].filter(Boolean);
  if (audience.length === 0) {
    const err = new Error('Google login is not configured on server');
    err.status = 500;
    throw err;
  }

  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience,
  });

  const payload = ticket.getPayload();
  if (!payload || !payload.email) {
    const err = new Error('Invalid Google token payload');
    err.status = 401;
    throw err;
  }

  const normalizedEmail = String(payload.email).trim().toLowerCase();
  const googleName = String(payload.name || normalizedEmail.split('@')[0] || 'User').trim();

  let result = await pool.query(
    'SELECT id, name, email, created_at FROM users WHERE email = $1',
    [normalizedEmail]
  );

  if (result.rows.length === 0) {
    const randomPassword = await bcrypt.hash(
      `${normalizedEmail}:${Date.now()}:${Math.random()}`,
      SALT_ROUNDS
    );
    result = await pool.query(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, created_at`,
      [googleName, normalizedEmail, randomPassword]
    );
  }

  const user = { ...result.rows[0], role: 'user' };
  const token = _generateToken(user);
  return { user, token };
}

function _generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role || 'user' },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

module.exports = { register, login, googleLogin };
