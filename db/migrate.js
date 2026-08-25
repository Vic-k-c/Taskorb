require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./pool');

async function columnExists(table, column) {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return rows.length > 0;
}

async function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  console.log('Running schema...');
  await pool.query(schema);

  // --- Upgrade path from the earlier single-board version of this app ---

  // Older deploys had lists.board_id missing entirely (table predates boards).
  const hasBoardId = await columnExists('lists', 'board_id');
  if (!hasBoardId) {
    console.log('Adding lists.board_id (upgrading from single-board schema)...');
    await pool.query('ALTER TABLE lists ADD COLUMN board_id INT REFERENCES boards(id) ON DELETE CASCADE');
  }

  // Older deploys had cards.interest_level instead of cards.priority.
  const hasInterestLevel = await columnExists('cards', 'interest_level');
  const hasPriority = await columnExists('cards', 'priority');
  if (hasInterestLevel && !hasPriority) {
    console.log('Renaming cards.interest_level -> cards.priority...');
    await pool.query('ALTER TABLE cards RENAME COLUMN interest_level TO priority');
  }

  // Cover photo support, added after the initial multi-board release.
  if (!(await columnExists('boards', 'cover_mime_type'))) {
    console.log('Adding boards.cover_mime_type / cover_data...');
    await pool.query('ALTER TABLE boards ADD COLUMN cover_mime_type TEXT');
    await pool.query('ALTER TABLE boards ADD COLUMN cover_data BYTEA');
  }
  if (!(await columnExists('cards', 'cover_attachment_id'))) {
    console.log('Adding cards.cover_attachment_id...');
    await pool.query('ALTER TABLE cards ADD COLUMN cover_attachment_id INT');
  }

  // Any lists left without a board (from the old single-board setup) get
  // swept into one legacy board so existing cards aren't orphaned.
  const { rows: orphanLists } = await pool.query('SELECT id FROM lists WHERE board_id IS NULL');
  if (orphanLists.length > 0) {
    console.log(`Found ${orphanLists.length} list(s) with no board -- creating a legacy board for them...`);
    const { rows: legacyBoard } = await pool.query(
      `INSERT INTO boards (title, description, template, owner_id) VALUES ($1, $2, $3, NULL) RETURNING id`,
      ['My Board', 'Recovered from an earlier version of this app.', 'blank']
    );
    await pool.query('UPDATE lists SET board_id = $1 WHERE board_id IS NULL', [legacyBoard[0].id]);
  }

  // Any board still without an owner (the legacy board above, or one created
  // before a user existed) gets claimed by the earliest-created admin, if any.
  const { rows: ownerlessBoards } = await pool.query('SELECT id FROM boards WHERE owner_id IS NULL');
  if (ownerlessBoards.length > 0) {
    const { rows: admins } = await pool.query(
      "SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1"
    );
    if (admins.length > 0) {
      const adminId = admins[0].id;
      console.log(`Assigning ${ownerlessBoards.length} ownerless board(s) to admin user #${adminId}...`);
      for (const b of ownerlessBoards) {
        await pool.query('UPDATE boards SET owner_id = $1 WHERE id = $2', [adminId, b.id]);
        await pool.query(
          `INSERT INTO board_members (board_id, user_id, permission) VALUES ($1, $2, 'owner')
           ON CONFLICT (board_id, user_id) DO UPDATE SET permission = 'owner'`,
          [b.id, adminId]
        );
      }
    }
  }

  console.log('Migration complete.');
  await pool.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
