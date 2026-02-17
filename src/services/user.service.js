/**
 * User profile service.
 */
const { v4: uuidv4 } = require('uuid');
const pool = require('../database/pool');
const supabase = require('../config/supabase');
const config = require('../config');

/**
 * Get user profile by ID.
 */
async function getProfile(userId) {
  const result = await pool.query(
    'SELECT id, name, email, profile_picture, created_at FROM users WHERE id = $1',
    [userId]
  );

  if (result.rows.length === 0) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  const user = result.rows[0];

  // Generate signed URL for profile picture if exists
  if (user.profile_picture) {
    const { data, error } = await supabase.storage
      .from(config.supabase.bucket)
      .createSignedUrl(user.profile_picture, 3600); // 1 hour expiry

    if (!error && data) {
      user.profile_picture_url = data.signedUrl;
    }
  }

  return user;
}

/**
 * Update user name.
 */
async function updateName(userId, newName) {
  if (!newName || newName.trim().length === 0) {
    const err = new Error('Name cannot be empty');
    err.status = 400;
    throw err;
  }

  const result = await pool.query(
    'UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING id, name, email, profile_picture',
    [newName.trim(), userId]
  );

  if (result.rows.length === 0) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  const user = result.rows[0];

  // Generate signed URL for profile picture if exists
  if (user.profile_picture) {
    const { data, error } = await supabase.storage
      .from(config.supabase.bucket)
      .createSignedUrl(user.profile_picture, 3600);

    if (!error && data) {
      user.profile_picture_url = data.signedUrl;
    }
  }

  return user;
}

/**
 * Upload or update profile picture.
 */
async function uploadProfilePicture(userId, file) {
  // 1. Delete old profile picture if exists
  const user = await pool.query(
    'SELECT profile_picture FROM users WHERE id = $1',
    [userId]
  );

  if (user.rows.length === 0) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  const oldPicture = user.rows[0].profile_picture;
  if (oldPicture) {
    await supabase.storage
      .from(config.supabase.bucket)
      .remove([oldPicture]);
  }

  // 2. Upload new profile picture
  const fileExt = file.mimetype.split('/')[1];
  const storagePath = `profiles/${userId}/${uuidv4()}.${fileExt}`;

  const { error: uploadError } = await supabase.storage
    .from(config.supabase.bucket)
    .upload(storagePath, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
    });

  if (uploadError) {
    const err = new Error(`Storage upload failed: ${uploadError.message}`);
    err.status = 500;
    throw err;
  }

  // 3. Update user record
  const result = await pool.query(
    'UPDATE users SET profile_picture = $1, updated_at = NOW() WHERE id = $2 RETURNING id, name, email, profile_picture',
    [storagePath, userId]
  );

  // 4. Generate signed URL
  const { data, error } = await supabase.storage
    .from(config.supabase.bucket)
    .createSignedUrl(storagePath, 3600);

  const userData = result.rows[0];
  if (!error && data) {
    userData.profile_picture_url = data.signedUrl;
  }

  return userData;
}

module.exports = {
  getProfile,
  updateName,
  uploadProfilePicture,
};
