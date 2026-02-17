/**
 * Database initializer — reads schema.sql and executes it.
 * Run with: npm run db:init
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

async function init() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf-8');

  try {
    await pool.query(sql);
    console.log('✅  Database schema applied successfully.');
  } catch (err) {
    console.error('❌  Failed to apply schema:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

init();
