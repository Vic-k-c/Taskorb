// Reconciles a database that was upgraded through several rounds of ad-hoc
// "ALTER TABLE IF NOT EXISTS"-style changes before this numbered migration
// system existed. A brand-new database created fresh from
// 001_initial_schema.js already has all of this -- every step here still
// checks first, so it's a safe no-op in that case.

async function columnExists(client, table, column) {
  const { rows } = await client.query(
    'SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2',
    [table, column]
  );
  return rows.length > 0;
}

async function up(client) {
  // Older deploys had lists.board_id missing entirely (table predates boards).
  if (!(await columnExists(client, 'lists', 'board_id'))) {
    console.log('  Adding lists.board_id (upgrading from single-board schema)...');
    await client.query('ALTER TABLE lists ADD COLUMN board_id INT REFERENCES boards(id) ON DELETE CASCADE');
  }

  // Older deploys had cards.interest_level instead of cards.priority.
  const hasInterestLevel = await columnExists(client, 'cards', 'interest_level');
  const hasPriority = await columnExists(client, 'cards', 'priority');
  if (hasInterestLevel && !hasPriority) {
    console.log('  Renaming cards.interest_level -> cards.priority...');
    await client.query('ALTER TABLE cards RENAME COLUMN interest_level TO priority');
  }

  // Cover photo support, added after the initial multi-board release.
  if (!(await columnExists(client, 'boards', 'cover_mime_type'))) {
    console.log('  Adding boards.cover_mime_type / cover_data...');
    await client.query('ALTER TABLE boards ADD COLUMN cover_mime_type TEXT');
    await client.query('ALTER TABLE boards ADD COLUMN cover_data BYTEA');
  }
  if (!(await columnExists(client, 'cards', 'cover_attachment_id'))) {
    console.log('  Adding cards.cover_attachment_id...');
    await client.query('ALTER TABLE cards ADD COLUMN cover_attachment_id INT');
  }

  // Per-user default board template preference, added with Account Settings.
  if (!(await columnExists(client, 'users', 'default_template'))) {
    console.log('  Adding users.default_template...');
    await client.query("ALTER TABLE users ADD COLUMN default_template TEXT DEFAULT 'blank'");
  }

  // Platform-level super-admin (separate from any org's own admins).
  if (!(await columnExists(client, 'users', 'is_platform_admin'))) {
    console.log('  Adding users.is_platform_admin...');
    await client.query('ALTER TABLE users ADD COLUMN is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE');
  }

  // Multi-tenancy: boards and notifications now belong to an organization.
  if (!(await columnExists(client, 'boards', 'org_id'))) {
    console.log('  Adding boards.org_id...');
    await client.query('ALTER TABLE boards ADD COLUMN org_id INT REFERENCES organizations(id) ON DELETE CASCADE');
    await client.query('CREATE INDEX IF NOT EXISTS idx_boards_org_id ON boards(org_id)');
  }
  if (!(await columnExists(client, 'notifications', 'org_id'))) {
    console.log('  Adding notifications.org_id...');
    await client.query('ALTER TABLE notifications ADD COLUMN org_id INT REFERENCES organizations(id) ON DELETE CASCADE');
  }

  // Any lists left without a board (from the old single-board setup) get
  // swept into one legacy board so existing cards aren't orphaned.
  const { rows: orphanLists } = await client.query('SELECT id FROM lists WHERE board_id IS NULL');
  if (orphanLists.length > 0) {
    console.log(`  Found ${orphanLists.length} list(s) with no board -- creating a legacy board for them...`);
    const { rows: legacyBoard } = await client.query(
      `INSERT INTO boards (title, description, template, owner_id) VALUES ($1, $2, $3, NULL) RETURNING id`,
      ['My Board', 'Recovered from an earlier version of this app.', 'blank']
    );
    await client.query('UPDATE lists SET board_id = $1 WHERE board_id IS NULL', [legacyBoard[0].id]);
  }

  // Any board still without an owner gets claimed by the earliest-created
  // legacy admin, if any (users.role still holds its old pre-org-members
  // value at this point in the upgrade path).
  const { rows: ownerlessBoards } = await client.query('SELECT id FROM boards WHERE owner_id IS NULL');
  if (ownerlessBoards.length > 0) {
    const { rows: admins } = await client.query(
      "SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1"
    );
    if (admins.length > 0) {
      const adminId = admins[0].id;
      console.log(`  Assigning ${ownerlessBoards.length} ownerless board(s) to admin user #${adminId}...`);
      for (const b of ownerlessBoards) {
        await client.query('UPDATE boards SET owner_id = $1 WHERE id = $2', [adminId, b.id]);
        await client.query(
          `INSERT INTO board_members (board_id, user_id, permission) VALUES ($1, $2, 'owner')
           ON CONFLICT (board_id, user_id) DO UPDATE SET permission = 'owner'`,
          [b.id, adminId]
        );
      }
    }
  }

  // Backfill: everything that existed before multi-tenancy becomes one
  // "Legacy Organization" so no existing data is orphaned or lost.
  const { rows: orglessBoards } = await client.query('SELECT id, owner_id FROM boards WHERE org_id IS NULL');
  if (orglessBoards.length > 0) {
    console.log(`  Found ${orglessBoards.length} board(s) with no organization -- creating a legacy org...`);
    const { rows: legacyOrgRows } = await client.query('SELECT id FROM organizations WHERE slug = $1', ['legacy']);
    let legacyOrgId;
    if (legacyOrgRows[0]) {
      legacyOrgId = legacyOrgRows[0].id;
    } else {
      const { rows: created } = await client.query(
        "INSERT INTO organizations (name, slug) VALUES ('Legacy Organization', 'legacy') RETURNING id"
      );
      legacyOrgId = created[0].id;
    }

    const { rows: allUsers } = await client.query('SELECT id, role FROM users');
    for (const u of allUsers) {
      await client.query(
        `INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, $3)
         ON CONFLICT (org_id, user_id) DO NOTHING`,
        [legacyOrgId, u.id, u.role]
      );
    }

    await client.query('UPDATE boards SET org_id = $1 WHERE org_id IS NULL', [legacyOrgId]);
    await client.query('UPDATE notifications SET org_id = $1 WHERE org_id IS NULL', [legacyOrgId]);
    console.log(`  Moved ${orglessBoards.length} board(s) and all existing users into "Legacy Organization".`);
  }
}

module.exports = { up };
