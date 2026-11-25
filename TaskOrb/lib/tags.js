// New organizations start with three tags mirroring the old fixed
// hot/warm/cold priority levels this system replaced -- a familiar
// starting point, fully renameable/deletable/extendable by the org's admin
// from the Tags page afterward.
const STARTER_TAGS = [
  { name: 'Hot', color: '#B5533C' },
  { name: 'Normal', color: '#3AA0E0' },
  { name: 'Low', color: '#6B7686' }
];

async function seedDefaultTags(client, orgId) {
  for (const t of STARTER_TAGS) {
    await client.query('INSERT INTO tags (org_id, board_id, name, color) VALUES ($1, NULL, $2, $3)', [orgId, t.name, t.color]);
  }
}

module.exports = { seedDefaultTags, STARTER_TAGS };
