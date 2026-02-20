/**
 * Auth service — handles user registration and login.
 *
 * SECURITY NOTES:
 * - Passwords are hashed with bcrypt (cost factor 12).
 * - JWT carries only { id, email, role } — no sensitive data.
 * - Token expiry is configurable via JWT_EXPIRES_IN.
 */
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const pool = require('../database/pool');
const config = require('../config');

const SALT_ROUNDS = 12;
const supabaseAuth = createClient(
  config.supabase.url,
  config.supabase.anonKey || config.supabase.serviceRoleKey
);

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
  const token = _generateToken(user);

  return { user, token };
}

/**
 * Send OTP to email via Supabase Auth.
 * This is used only for email verification; app auth still uses local JWT.
 */
async function sendOtp({ email }) {
  const normalizedEmail = String(email).trim().toLowerCase();

  const { error } = await supabaseAuth.auth.signInWithOtp({
    email: normalizedEmail,
    options: {
      shouldCreateUser: true,
    },
  });

  if (error) {
    const err = new Error(`Failed to send OTP: ${error.message}`);
    err.status = 400;
    throw err;
  }

  return { message: 'OTP sent to email' };
}

/**
 * Verify OTP via Supabase Auth and issue local app JWT.
 *
 * If user exists in local DB => return that user + JWT.
 * If user doesn't exist => create local user and then return JWT.
 */
async function verifyOtp({ email, token, name }) {
  const normalizedEmail = String(email).trim().toLowerCase();

  const { error } = await supabaseAuth.auth.verifyOtp({
    email: normalizedEmail,
    token: String(token).trim(),
    type: 'email',
  });

  if (error) {
    const err = new Error(`OTP verification failed: ${error.message}`);
    err.status = 401;
    throw err;
  }

  // Try existing local user first.
  let result = await pool.query(
    'SELECT id, name, email, created_at FROM users WHERE email = $1',
    [normalizedEmail]
  );

  let user;
  let isNewUser = false;

  if (result.rows.length > 0) {
    user = result.rows[0];
  } else {
    const displayName = name?.trim() || normalizedEmail.split('@')[0] || 'User';

    // Local schema requires password_hash; generate a random one for OTP-created users.
    const randomPassword = crypto.randomBytes(32).toString('hex');
    const passwordHash = await bcrypt.hash(randomPassword, SALT_ROUNDS);

    result = await pool.query(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, created_at`,
      [displayName, normalizedEmail, passwordHash]
    );

    user = result.rows[0];
    isNewUser = true;
  }

  const tokenJwt = _generateToken(user);
  return {
    user,
    token: tokenJwt,
    is_new_user: isNewUser,
  };
}

function _generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

module.exports = { register, login, sendOtp, verifyOtp };
