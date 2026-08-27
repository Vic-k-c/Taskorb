// By the time this runs, 002_legacy_upgrades.js has already backfilled
// org_id everywhere it could be missing -- so it's safe to enforce NOT NULL
// on columns that were left nullable earlier purely to allow that backfill
// to happen without a chicken-and-egg failure on existing rows.

async function up(client) {
  // Any notification somehow left without an org (shouldn't happen -- every
  // code path that creates one passes the active org -- but if one slipped
  // through under an earlier version, there's no reliable way to guess
  // which org it belonged to, so drop it rather than guess wrong).
  const { rowCount: droppedNotifications } = await client.query('DELETE FROM notifications WHERE org_id IS NULL');
  if (droppedNotifications > 0) {
    console.log(`  Dropped ${droppedNotifications} notification(s) with no organization (could not be attributed).`);
  }

  // These SET NOT NULL calls are themselves safe to re-run -- Postgres
  // treats re-applying NOT NULL to an already-NOT-NULL column as a no-op.
  await client.query('ALTER TABLE boards ALTER COLUMN org_id SET NOT NULL');
  await client.query('ALTER TABLE notifications ALTER COLUMN org_id SET NOT NULL');
  await client.query('ALTER TABLE lists ALTER COLUMN board_id SET NOT NULL');
}

module.exports = { up };
