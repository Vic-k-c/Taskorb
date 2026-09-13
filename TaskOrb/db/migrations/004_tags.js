const { seedDefaultTags, STARTER_TAGS } = require('../../lib/tags');

async function up(client) {
  // Tables already exist on a fresh install (001_initial_schema.js runs the
  // current schema.sql, which already includes them) -- these are here for
  // any database that ran 001 before tags existed.
  await client.query(`
    CREATE TABLE IF NOT EXISTS tags (
      id         SERIAL PRIMARY KEY,
      org_id     INT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      board_id   INT REFERENCES boards(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      color      TEXT NOT NULL DEFAULT '#3AA0E0',
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await client.query('CREATE INDEX IF NOT EXISTS idx_tags_org ON tags(org_id)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_tags_board ON tags(board_id)');
  await client.query(`
    CREATE TABLE IF NOT EXISTS card_tags (
      card_id INT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      tag_id  INT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (card_id, tag_id)
    )
  `);
  await client.query('CREATE INDEX IF NOT EXISTS idx_card_tags_tag ON card_tags(tag_id)');

  // Every existing org gets the three starter tags, and every existing
  // card's old priority value gets carried forward as that matching tag --
  // so nothing about an existing board looks different after this
  // migration runs, it's just represented as a tag now instead of a fixed
  // enum column.
  const { rows: orgs } = await client.query('SELECT id FROM organizations');
  for (const org of orgs) {
    const { rows: existing } = await client.query('SELECT id FROM tags WHERE org_id = $1 AND board_id IS NULL', [org.id]);
    if (existing.length > 0) continue; // already has org-wide tags somehow; don't duplicate

    await seedDefaultTags(client, org.id);
    const { rows: newTags } = await client.query(
      'SELECT id, name FROM tags WHERE org_id = $1 AND board_id IS NULL',
      [org.id]
    );
    const tagIdByStarterName = {};
    newTags.forEach((t) => { tagIdByStarterName[t.name] = t.id; });
    const priorityToTagName = { hot: 'Hot', warm: 'Normal', cold: 'Low' };

    const { rows: cards } = await client.query(
      `SELECT c.id, c.priority FROM cards c
       JOIN lists l ON l.id = c.list_id
       JOIN boards b ON b.id = l.board_id
       WHERE b.org_id = $1`,
      [org.id]
    );
    for (const card of cards) {
      const tagName = priorityToTagName[card.priority] || 'Normal';
      const tagId = tagIdByStarterName[tagName];
      if (tagId) {
        await client.query('INSERT INTO card_tags (card_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [card.id, tagId]);
      }
    }
  }
}

module.exports = { up };
