/**
 * Supabase client (service-role) — gives admin access to private bucket.
 *
 * WHY service-role key?
 *   The storage bucket is PRIVATE. Only the backend should generate
 *   signed URLs or upload files. The service-role key bypasses RLS
 *   so the server can manage files on behalf of users.
 */
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);

module.exports = supabase;
