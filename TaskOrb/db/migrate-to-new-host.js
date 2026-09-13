require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// One-time database migration: copies everything from the OLD database
// (DATABASE_URL -- still Render at this point) into the NEW database
// (MIGRATION_TARGET_URL -- Neon), including explicit primary key values so
// foreign keys stay valid, then fixes each table's auto-increment sequence
// afterward so future inserts continue from the right number instead of
// colliding with the copied rows.
//
// Deliberately does NOT touch the live DATABASE_URL -- run this via a
// temporary Start Command override (see README), confirm the row counts
// printed at the end look right, THEN switch DATABASE_URL over yourself.
//
// Tables copied in FK-dependency order. `session` is skipped on purpose
// (transient login state -- everyone just logs in again after the switch,
// which is fine). `schema_migrations` is also skipped on purpose: leaving
// it empty means the normal `npm run migrate` step (which runs right after
// this, as part of restoring the usual start command) re-checks everything
// against the newly-copied data and finds it already correctly structured
// -- every migration in this app is written to be a safe no-op when there's
// nothing left to do.
const TABLES = [
  { name: 'organizations', hasSerialId: true },
  { name: 'users', hasSerialId: true },
  { name: 'org_members', hasSerialId: false }, // composite PK (org_id, user_id)
  { name: 'boards', hasSerialId: true },
  { name: 'board_members', hasSerialId: false }, // composite PK (board_id, user_id)
  { name: 'tags', hasSerialId: true },
  { name: 'lists', hasSerialId: true },
  { name: 'cards', hasSerialId: true },
  { name: 'card_tags', hasSerialId: false }, // composite PK (card_id, tag_id)
  { name: 'card_attachments', hasSerialId: true },
  { name: 'notifications', hasSerialId: true }
];

async function main() {
  if (!process.env.MIGRATION_TARGET_URL) {
    console.error('MIGRATION_TARGET_URL is not set. Add it as an env var (the new Neon connection string) before running this.');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set (should still be pointing at the OLD database for this step).');
    process.exit(1);
  }

  const sourcePool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
  });
  const targetPool = new Pool({
    connectionString: process.env.MIGRATION_TARGET_URL,
    ssl: { rejectUnauthorized: false }
  });

  console.log('Creating schema on the new database...');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await targetPool.query(schema);

  const summary = [];

  for (const table of TABLES) {
    const { rows } = await sourcePool.query(`SELECT * FROM ${table.name}`);
    if (rows.length === 0) {
      summary.push(`${table.name}: 0 rows (nothing to copy)`);
      continue;
    }

    const columns = Object.keys(rows[0]);
    const columnList = columns.map((c) => `"${c}"`).join(', ');

    for (const row of rows) {
      const values = columns.map((c) => row[c]);
      const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
      await targetPool.query(
        `INSERT INTO ${table.name} (${columnList}) VALUES (${placeholders})
         ON CONFLICT DO NOTHING`,
        values
      );
    }

    if (table.hasSerialId) {
      await targetPool.query(
        `SELECT setval(pg_get_serial_sequence('${table.name}', 'id'), COALESCE((SELECT MAX(id) FROM ${table.name}), 1))`
      );
    }

    summary.push(`${table.name}: ${rows.length} rows copied`);
    console.log(`  ${table.name}: ${rows.length} rows copied`);
  }

  console.log('\n=== MIGRATION COMPLETE ===');
  summary.forEach((line) => console.log('  ' + line));
  console.log('\nIf these counts look right, go set DATABASE_URL to the Neon connection string,');
  console.log('remove MIGRATION_TARGET_URL, and restore the normal start command.');

  await sourcePool.end();
  await targetPool.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
