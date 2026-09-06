require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./pool');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         SERIAL PRIMARY KEY,
      name       TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(client) {
  const { rows } = await client.query('SELECT name FROM schema_migrations');
  return new Set(rows.map((r) => r.name));
}

async function runMigrations() {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);

    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.js'))
      .sort(); // filenames are zero-padded (001_, 002_, ...) so lexical sort == run order

    let ranAny = false;
    for (const file of files) {
      if (applied.has(file)) continue;

      ranAny = true;
      console.log(`Running migration: ${file}`);
      const migration = require(path.join(MIGRATIONS_DIR, file));

      await client.query('BEGIN');
      try {
        await migration.up(client);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`  Done: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
    }

    if (!ranAny) console.log('No pending migrations -- database is up to date.');
  } finally {
    client.release();
  }
}

// Platform admin bootstrap runs on every invocation, not just once -- it's
// not a schema change, it's a "re-check this env var" step, since the env
// var itself can change between deploys without any migration being added.
async function bootstrapPlatformAdmin() {
  if (!process.env.PLATFORM_ADMIN_EMAIL) return;
  const email = process.env.PLATFORM_ADMIN_EMAIL.toLowerCase().trim();
  const { rows: promoted } = await pool.query(
    'UPDATE users SET is_platform_admin = TRUE WHERE email = $1 AND is_platform_admin = FALSE RETURNING id',
    [email]
  );
  if (promoted.length > 0) console.log(`Granted platform admin to ${email}.`);
}

async function main() {
  await runMigrations();
  await bootstrapPlatformAdmin();
  console.log('Migration complete.');
  await pool.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
