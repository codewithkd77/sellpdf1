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
 * Creates a pending signup and sends OTP.
 * Real user is created only after OTP verification.
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
  try {
    await pool.query(
      `INSERT INTO pending_registrations (email, name, password_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (email)
       DO UPDATE SET name = EXCLUDED.name,
                     password_hash = EXCLUDED.password_hash,
                     created_at = NOW()`,
      [normalizedEmail, name.trim(), passwordHash]
    );
  } catch (dbErr) {
    // Postgres unique_violation safeguard for any race conditions.
    if (dbErr && dbErr.code === '23505') {
      const err = new Error(duplicateEmailMessage);
      err.status = 409;
      throw err;
    }
    throw dbErr;
  }

  await _sendEmailOtp(normalizedEmail);
  return {
    otp_sent: true,
    requires_verification: true,
    message: 'OTP sent to email. Verify OTP to complete registration.',
  };
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
  await _sendEmailOtp(normalizedEmail);

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
  const duplicateEmailMessage =
    'This email is already used. Please log in or use another email instead.';

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

  const pendingRes = await pool.query(
    'SELECT email, name, password_hash FROM pending_registrations WHERE email = $1',
    [normalizedEmail]
  );

  if (pendingRes.rows.length > 0) {
    const pending = pendingRes.rows[0];

    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [normalizedEmail]
    );
    if (existingUser.rows.length > 0) {
      await pool.query('DELETE FROM pending_registrations WHERE email = $1', [normalizedEmail]);
      return {
        verified: true,
        requires_login: true,
        message: 'Email already verified. Please log in.',
      };
    }

    let userRes;
    try {
      userRes = await pool.query(
        `INSERT INTO users (name, email, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id, name, email, created_at`,
        [pending.name, pending.email, pending.password_hash]
      );
    } catch (dbErr) {
      if (dbErr && dbErr.code === '23505') {
        await pool.query('DELETE FROM pending_registrations WHERE email = $1', [normalizedEmail]);
        const err = new Error(duplicateEmailMessage);
        err.status = 409;
        throw err;
      }
      throw dbErr;
    }
    const user = userRes.rows[0];
    await pool.query('DELETE FROM pending_registrations WHERE email = $1', [normalizedEmail]);

    return {
      user,
      verified: true,
      requires_login: true,
      message: 'Email verified successfully. Please log in.',
    };
  }

  // If no pending signup, only allow acknowledgement for existing users.
  const result = await pool.query(
    'SELECT id, name, email, created_at FROM users WHERE email = $1',
    [normalizedEmail]
  );

  if (result.rows.length === 0) {
    const err = new Error('No pending registration found for this email');
    err.status = 400;
    throw err;
  }

  return {
    user: result.rows[0],
    verified: true,
    requires_login: true,
    message: 'Email verified. Please log in.',
  };
}

function _generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

async function _sendEmailOtp(email) {
  const { error } = await supabaseAuth.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
    },
  });

  if (error) {
    const err = new Error(`Failed to send OTP: ${error.message}`);
    err.status = 400;
    throw err;
  }
}

module.exports = { register, login, sendOtp, verifyOtp };
