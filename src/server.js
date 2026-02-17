/**
 * Server entry point.
 */
const fs = require('fs');
const path = require('path');
const app = require('./app');
const config = require('./config');
const pool = require('./database/pool');

async function initializeDatabase() {
  try {
    const schemaPath = path.join(__dirname, 'database', 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    await pool.query(schema);
    console.log('✅  Database schema initialized');
  } catch (err) {
    console.error('⚠️  Schema initialization error:', err.message);
    // Don't exit - tables might already exist
  }
}

async function start() {
  // Quick DB connectivity check
  try {
    await pool.query('SELECT 1');
    console.log('✅  Connected to PostgreSQL');
  } catch (err) {
    console.error('❌  PostgreSQL connection failed:', err.message);
    process.exit(1);
  }

  // Auto-initialize database schema (safe to run multiple times)
  await initializeDatabase();

  const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';
  app.listen(config.port, host, () => {
    console.log(`🚀  Server running on http://${host}:${config.port}  [${config.nodeEnv}]`);
  });
}

start();
