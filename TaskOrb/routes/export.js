const express = require('express');
const PDFDocument = require('pdfkit');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireOrg } = require('../lib/org');

const router = express.Router();

async function getExportRows(userId, orgId, orgRole) {
  const isOrgAdmin = orgRole === 'admin';
  const boardFilter = isOrgAdmin
    ? 'WHERE b.org_id = $1'
    : 'JOIN board_members bm ON bm.board_id = b.id AND bm.user_id = $2 WHERE b.org_id = $1';
  const params = isOrgAdmin ? [orgId] : [orgId, userId];

  const { rows } = await pool.query(`
    SELECT c.id, c.name, c.phone, c.email, c.address, c.notes,
           l.name AS list_name, b.title AS board_title, u.name AS assigned_name, c.created_at
    FROM cards c
    JOIN lists l ON l.id = c.list_id
    JOIN boards b ON b.id = l.board_id
    ${boardFilter}
    LEFT JOIN users u ON u.id = c.assigned_to
    ORDER BY b.title ASC, l.position ASC, c.created_at ASC
  `, params);

  const cardIds = rows.map((r) => r.id);
  if (cardIds.length > 0) {
    const { rows: tagRows } = await pool.query(
      `SELECT ct.card_id, t.name FROM card_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.card_id = ANY($1::int[])`,
      [cardIds]
    );
    const tagsByCard = {};
    tagRows.forEach((row) => {
      if (!tagsByCard[row.card_id]) tagsByCard[row.card_id] = [];
      tagsByCard[row.card_id].push(row.name);
    });
    rows.forEach((r) => { r.tags = (tagsByCard[r.id] || []).join(', '); });
  } else {
    rows.forEach((r) => { r.tags = ''; });
  }

  return rows;
}

router.get('/export/pdf', requireAuth, requireOrg, async (req, res) => {
  try {
    const rows = await getExportRows(req.session.user.id, req.orgId, req.orgRole);
    const doc = new PDFDocument({ margin: 40, size: 'A4' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="taskorb-report.pdf"');
    doc.pipe(res);

    doc.fontSize(20).text('TaskOrb Report', { align: 'left' });
    doc.fontSize(10).fillColor('#666').text(`Generated ${new Date().toLocaleString()}`);
    doc.moveDown(1);
    doc.fillColor('#000');

    let currentGroup = null;
    rows.forEach((row) => {
      const groupLabel = `${row.board_title} / ${row.list_name}`;
      if (groupLabel !== currentGroup) {
        currentGroup = groupLabel;
        doc.moveDown(0.5);
        doc.fontSize(14).fillColor('#1B2A41').text(currentGroup, { underline: true });
        doc.fillColor('#000');
      }
      doc.fontSize(11).text(row.tags ? `${row.name}  (${row.tags})` : row.name, { continued: false });
      const details = [
        row.phone ? `Phone: ${row.phone}` : null,
        row.email ? `Email: ${row.email}` : null,
        row.address ? `Address: ${row.address}` : null,
        row.assigned_name ? `Assigned: ${row.assigned_name}` : null
      ].filter(Boolean).join('   |   ');
      if (details) doc.fontSize(9).fillColor('#555').text(details);
      if (row.notes) doc.fontSize(9).fillColor('#555').text(`Notes: ${row.notes}`);
      doc.fillColor('#000');
      doc.moveDown(0.4);
    });

    if (rows.length === 0) {
      doc.fontSize(11).text('No cards recorded yet.');
    }

    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).send('Could not generate PDF.');
  }
});

router.get('/export/csv', requireAuth, requireOrg, async (req, res) => {
  try {
    const rows = await getExportRows(req.session.user.id, req.orgId, req.orgRole);
    const header = ['Board', 'List', 'Name', 'Phone', 'Email', 'Address', 'Tags', 'Assigned To', 'Notes', 'Created'];
    const escape = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const lines = [header.map(escape).join(',')];
    rows.forEach((r) => {
      lines.push([
        r.board_title, r.list_name, r.name, r.phone, r.email, r.address, r.tags,
        r.assigned_name, r.notes, r.created_at ? r.created_at.toISOString() : ''
      ].map(escape).join(','));
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="taskorb-export.csv"');
    res.send(lines.join('\n'));
  } catch (err) {
    console.error(err);
    res.status(500).send('Could not generate CSV.');
  }
});

module.exports = router;
