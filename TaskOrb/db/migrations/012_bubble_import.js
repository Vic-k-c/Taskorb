// Support for importing data exported from the old Bubble.io app.
// bubble_import_rows keeps EVERY row of every uploaded file (even types
// TaskOrb has no screen for yet, like Meetings or Items) so nothing is lost
// and later features can use it. bubble_id on the real tables records where
// a row came from, so a re-run never creates duplicates.
async function up(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS bubble_import_batches (
      id         SERIAL PRIMARY KEY,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      status     TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','imported')),
      files      JSONB NOT NULL DEFAULT '[]',
      result     JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      imported_at TIMESTAMP
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS bubble_import_rows (
      id        SERIAL PRIMARY KEY,
      batch_id  INT NOT NULL REFERENCES bubble_import_batches(id) ON DELETE CASCADE,
      type      TEXT NOT NULL,
      bubble_id TEXT,
      data      JSONB NOT NULL
    )
  `);
  await client.query('CREATE INDEX IF NOT EXISTS idx_bubble_rows_batch ON bubble_import_rows(batch_id, type)');
  for (const t of ['organizations', 'boards', 'lists', 'cards', 'users']) {
    await client.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS bubble_id TEXT`);
  }
  await client.query('CREATE INDEX IF NOT EXISTS idx_boards_bubble ON boards(bubble_id) WHERE bubble_id IS NOT NULL');
  await client.query('CREATE INDEX IF NOT EXISTS idx_orgs_bubble ON organizations(bubble_id) WHERE bubble_id IS NOT NULL');
}

module.exports = { up };
