/**
 * PostgreSQL connection pool — singleton.
 */
const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool(config.db);

// Log connection errors at pool level
pool.on('error', (err) => {
  console.error('Unexpected PG pool error:', err.message);
});

module.exports = pool;
