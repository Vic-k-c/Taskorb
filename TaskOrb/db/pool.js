const { Pool } = require('pg');

// Render's managed Postgres requires SSL, but does not present a
// publicly-trusted CA chain by default, so we disable strict verification.
// Locally (no DATABASE_URL SSL requirement) this flag is simply ignored.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false }
});

module.exports = pool;
