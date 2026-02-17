/**
 * Server entry point.
 */
const app = require('./app');
const config = require('./config');
const pool = require('./database/pool');

async function start() {
  // Quick DB connectivity check
  try {
    await pool.query('SELECT 1');
    console.log('✅  Connected to PostgreSQL');
  } catch (err) {
    console.error('❌  PostgreSQL connection failed:', err.message);
    process.exit(1);
  }

  const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';
  app.listen(config.port, host, () => {
    console.log(`🚀  Server running on http://${host}:${config.port}  [${config.nodeEnv}]`);
  });
}

start();
