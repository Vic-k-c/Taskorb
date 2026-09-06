// Baseline schema for a brand-new database. Every CREATE TABLE / INDEX here
// uses IF NOT EXISTS, so this is also safe to run against a database that
// already has some or all of these objects (which matters because this
// migration system was introduced after several rounds of ad-hoc changes --
// see 002_legacy_upgrades.js for reconciling anything this doesn't cover).
const fs = require('fs');
const path = require('path');

async function up(client) {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  await client.query(schema);
}

module.exports = { up };
