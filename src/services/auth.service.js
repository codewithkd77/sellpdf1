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
const pool = require('../database/pool');
const config = require('../config');

const SALT_ROUNDS = 12;

/**
 * Register a new user.
 * @returns {{ user, token }}
 */
async function register({ name, email, password }) {
  // Check for existing email
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    const err = new Error('Email already registered');
    err.status = 409;
    throw err;
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const result = await pool.query(
    `INSERT INTO users (name, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, name, email, created_at`,
    [name, email, passwordHash]
  );

  const user = result.rows[0];
  const token = _generateToken(user);

  return { user, token };
}

/**
 * Login an existing user.
 * @returns {{ user, token }}
 */
async function login({ email, password }) {
  const result = await pool.query(
    'SELECT id, name, email, password_hash FROM users WHERE email = $1',
    [email]
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
  const token = _generateToken(user);

  return { user, token };
}

function _generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

module.exports = { register, login };
