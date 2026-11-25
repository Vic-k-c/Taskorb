const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { uniqueSlug } = require('./org');
const { parseCsv } = require('./csv');

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// Tolerant header lookup: "Board Title", "board_title" and "boardtitle" all match.
function g(row, ...names) {
  const map = row.__n || (Object.defineProperty(row, '__n', { value: Object.fromEntries(Object.keys(row).map((k) => [norm(k), k])), enumerable: false }), row.__n);
  for (const n of names) { const k = map[norm(n)]; if (k !== undefined && String(row[k]).trim() !== '') return String(row[k]).trim(); }
  return '';
}
// Bubble writes lists as "a , b , c". Emails and names never contain " , ".
const splitList = (s) => String(s || '').split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean);
const isEmail = (s) => /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(s);
const emails = (s) => splitList(s).map((x) => x.toLowerCase()).filter(isEmail);
const lc = (s) => String(s || '').trim().toLowerCase();

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
// Bubble: "Dec 3, 2024 6:30 pm" (no timezone). Treated as Nairobi time (UTC+3).
function parseBubbleDate(s, offsetHours = 3) {
  const m = /^([A-Za-z]{3})[a-z]* (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2}) ?(am|pm)$/i.exec(String(s || '').trim());
  if (!m) return null;
  let h = Number(m[4]) % 12; if (m[6].toLowerCase() === 'pm') h += 12;
  const mo = MONTHS[m[1].toLowerCase()];
  if (mo === undefined) return null;
  return new Date(Date.UTC(Number(m[3]), mo, Number(m[2]), h - offsetHours, Number(m[5])));
}

const TYPE_BY_NAME = [
  ['task', /task/i], ['list', /list/i], ['board', /board/i], ['team', /team/i], ['user', /user/i],
  ['location', /location/i], ['meeting', /meeting/i], ['item', /item/i], ['comment', /comment/i]
];
function detectType(filename, headers) {
  const h = new Set(headers.map(norm));
  if (h.has('currentlist')) return 'task';
  if (h.has('ogtask')) return 'location';
  if (h.has('ogboard')) return 'list';
  if (h.has('boardtitle')) return 'board';
  if (h.has('ogworkstation') || (h.has('boardsjoined') && h.has('username'))) return h.has('username') ? 'user' : 'board';
  if (h.has('members') && h.has('admin') && h.has('name') && h.has('teamboards')) return 'team';
  for (const [t, re] of TYPE_BY_NAME) if (re.test(filename)) return t;
  return 'other';
}

// --- Turn the raw rows of one batch into a plan: orgs -> boards -> lists -> cards ---
function buildPlan(rows) {
  const warnings = [];
  const R = (t) => rows[t] || [];
  const people = new Map(); // email -> {email, name, teams[]}
  const person = (email, name) => {
    if (!email) return null;
    if (!people.has(email)) people.set(email, { email, name: '', teams: [] });
    const p = people.get(email);
    if (name && !p.name) p.name = name;
    return p;
  };

  for (const r of R('user')) {
    const email = lc(g(r, 'email'));
    if (!isEmail(email)) continue;
    const name = [g(r, 'First Name'), g(r, 'Last Name')].filter(Boolean).join(' ') || g(r, 'Username', 'Name');
    const p = person(email, name);
    p.teams = splitList(g(r, 'teams'));
    p.bid = g(r, 'unique id');
  }

  // Organisations come from Teams.
  const orgs = [];
  const orgByName = new Map();
  const addOrg = (name, bid, admins, members) => {
    const org = { key: bid || name, bid: bid || null, name, admins: new Set(admins), members: new Set(members), boards: [] };
    orgs.push(org); orgByName.set(lc(name), org);
    org.admins.forEach((e) => person(e)); org.members.forEach((e) => person(e));
    return org;
  };
  for (const r of R('team')) {
    const name = g(r, 'Name', 'Team Name');
    if (!name) continue;
    const creator = lc(g(r, 'Creator'));
    const admins = emails(g(r, 'Admin', 'Admins'));
    if (!admins.length && isEmail(creator)) admins.push(creator);
    addOrg(name, g(r, 'unique id'), admins, emails(g(r, 'Members')));
  }
  let fallbackOrg = null;
  const orgFor = (teamName) => {
    const o = orgByName.get(lc(teamName));
    if (o) return o;
    if (!fallbackOrg) { fallbackOrg = addOrg('Imported from Bubble', null, [], []); warnings.push('Some boards have no matching team and are placed in an organisation called "Imported from Bubble".'); }
    return fallbackOrg;
  };

  // Boards
  const boardsByTitle = new Map();
  for (const r of R('board')) {
    const title = g(r, 'Board Title', 'Title', 'Name');
    if (!title) continue;
    const org = orgFor(g(r, 'OGWorkStation', 'Team'));
    const b = {
      bid: g(r, 'unique id') || null, title, org,
      admins: emails(g(r, 'Admins')), members: emails(g(r, 'members', 'Members')),
      creator: lc(g(r, 'Creator')), lists: [], unsorted: false
    };
    if (!isEmail(b.creator)) b.creator = '';
    [...b.admins, ...b.members, b.creator].forEach((e) => e && person(e));
    org.boards.push(b);
    const k = lc(title);
    boardsByTitle.set(k, (boardsByTitle.get(k) || []).concat(b));
  }

  // Lists
  const listsByName = new Map();
  let ambiguousLists = 0;
  for (const r of R('list')) {
    const name = g(r, 'Name');
    if (!name) continue;
    const cands = boardsByTitle.get(lc(g(r, 'OG Board', 'Board'))) || [];
    if (!cands.length) { warnings.push(`List "${name}" points to board "${g(r, 'OG Board', 'Board')}" which isn't in the Boards file; skipped.`); continue; }
    if (cands.length > 1) ambiguousLists++;
    const board = cands[0];
    const l = { bid: g(r, 'unique id') || null, name, pos: Number(g(r, 'Position Number')) || 0, tasksText: lc(g(r, 'tasks')), board, cards: [] };
    board.lists.push(l);
    listsByName.set(lc(name), (listsByName.get(lc(name)) || []).concat(l));
  }
  if (ambiguousLists) warnings.push(`${ambiguousLists} list(s) belong to a board title used more than once; they were placed on the first board with that title.`);
  orgs.forEach((o) => o.boards.forEach((b) => b.lists.sort((a, c) => a.pos - c.pos)));

  // Tasks -> cards
  const stats = { cards: 0, skippedNoTitle: 0, unsorted: 0, noUnsortedHome: 0, withDue: 0, done: 0 };
  const unsortedBoard = (org) => {
    let b = org.boards.find((x) => x.unsorted);
    if (!b) {
      b = { bid: null, title: 'Imported - unsorted', org, admins: [], members: [], creator: '', lists: [{ bid: null, name: 'Unsorted', pos: 0, tasksText: '', cards: [], board: null }], unsorted: true };
      b.lists[0].board = b; org.boards.push(b);
    }
    return b.lists[0];
  };
  const cardIndex = new Map(); const cardsByTitle = new Map();
  for (const r of R('task')) {
    const title = g(r, 'Title');
    if (!title) { stats.skippedNoTitle++; continue; }
    const listName = lc(g(r, 'Current List'));
    let cands = listsByName.get(listName) || [];
    if (cands.length > 1) {
      const narrowed = cands.filter((l) => l.tasksText && l.tasksText.includes(lc(title)));
      if (narrowed.length >= 1) cands = narrowed;
    }
    const creator = lc(g(r, 'Creator'));
    const assignees = emails(g(r, 'Assigned to'));
    const card = {
      bid: g(r, 'unique id') || null, title,
      description: String(r.Description !== undefined ? r.Description : g(r, 'Description')).trim(),
      assignees, creator: isEmail(creator) ? creator : '',
      due: parseBubbleDate(g(r, 'Due Date')), start: g(r, 'Start Date'),
      complete: lc(g(r, 'Complete')) === 'yes',
      pos: Number(g(r, 'Position number')) || 0,
      created: parseBubbleDate(g(r, 'Creation Date')),
      attachments: splitList(g(r, 'Attachments')).map((u) => (u.startsWith('//') ? 'https:' + u : u)),
      comments: g(r, 'comments')
    };
    [...assignees, card.creator].forEach((e) => e && person(e));
    let list;
    if (cands.length === 1) list = cands[0];
    else {
      // Not resolvable from names alone -> the creator's organisation, "Unsorted" list.
      const p = people.get(card.creator);
      const teamName = p && p.teams.find((t) => orgByName.has(lc(t)));
      const org = (teamName && orgByName.get(lc(teamName))) || orgs[0];
      if (!org) { stats.noUnsortedHome++; continue; }
      list = unsortedBoard(org); stats.unsorted++;
    }
    list.cards.push(card); stats.cards++;
    card.boardTitle = list.board ? list.board.title : '';
    const ik = lc(card.boardTitle) + '|' + lc(title);
    (cardIndex.get(ik) || cardIndex.set(ik, []).get(ik)).push(card);
    (cardsByTitle.get(lc(title)) || cardsByTitle.set(lc(title), []).get(lc(title))).push(card);
    if (card.due) stats.withDue++;
    if (card.complete) stats.done++;
  }
  // Locations -> the card's map pin. A Bubble Location names its board and
  // task (by title), so match on both; identical titles are paired in order.
  stats.pins = 0; stats.locUnmatched = 0; stats.locAddressOnly = 0; stats.locExtra = 0;
  for (const r of R('location')) {
    const taskTitle = lc(g(r, 'OG Task', 'Task'));
    if (!taskTitle) { stats.locUnmatched++; continue; }
    const boardTitle = lc(g(r, 'OG Board', 'Board'));
    let cands = (boardTitle && cardIndex.get(boardTitle + '|' + taskTitle)) || [];
    if (!cands.length) cands = cardsByTitle.get(taskTitle) || [];
    const card = cands.find((c) => !c.loc) || cands[0];
    if (!card) { stats.locUnmatched++; continue; }
    const lat = parseFloat(g(r, 'Latitude')), lng = parseFloat(g(r, 'Longitude'));
    const hasPin = Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
    const loc = { lat: hasPin ? lat : null, lng: hasPin ? lng : null, address: g(r, 'Address'), name: g(r, 'Name') };
    if (card.loc) {
      (card.extraLocs = card.extraLocs || []).push(loc); stats.locExtra++; continue;
    }
    card.loc = loc;
    if (hasPin) stats.pins++; else stats.locAddressOnly++;
  }
  if (stats.locUnmatched) warnings.push(`${stats.locUnmatched} location(s) couldn't be matched to a task (title not found) and are only kept in the archive.`);
  if (stats.locAddressOnly) warnings.push(`${stats.locAddressOnly} location(s) have an address but no coordinates: the address is saved on the card but there is no map pin yet.`);
  if (stats.locExtra) warnings.push(`${stats.locExtra} task(s) had more than one location; the first is the map pin and the rest are listed in the card's notes.`);

  // Everyone referenced needs an org membership to be given board access.
  for (const o of orgs) {
    for (const b of o.boards) {
      [...b.admins, ...b.members, b.creator].filter(Boolean).forEach((e) => { if (!o.admins.has(e)) o.members.add(e); });
      b.lists.forEach((l) => l.cards.forEach((c) => [...c.assignees, c.creator].filter(Boolean).forEach((e) => { if (!o.admins.has(e)) o.members.add(e); })));
    }
  }
  if (stats.noUnsortedHome) warnings.push(`${stats.noUnsortedHome} task(s) could not be placed anywhere (no organisation to hold them).`);
  if (stats.unsorted) warnings.push(`${stats.unsorted} task(s) couldn't be matched to one list by name (same list name on several boards) and go to an "Imported - unsorted" board for an admin to sort.`);
  if (stats.skippedNoTitle) warnings.push(`${stats.skippedNoTitle} task(s) had no title and were skipped.`);

  const counts = {
    orgs: orgs.length, users: people.size,
    boards: orgs.reduce((n, o) => n + o.boards.length, 0),
    lists: orgs.reduce((n, o) => n + o.boards.reduce((m, b) => m + b.lists.length, 0), 0),
    cards: stats.cards, pins: stats.pins, withDue: stats.withDue, done: stats.done, unsorted: stats.unsorted
  };
  return { orgs, people, warnings, counts };
}

const noteFor = (c) => {
  const parts = [];
  if (c.description) parts.push(c.description);
  if (c.assignees.length > 1) parts.push(`Also assigned in Bubble: ${c.assignees.slice(1).join(', ')}`);
  if (c.start) parts.push(`Start date (Bubble): ${c.start}`);
  if (c.extraLocs && c.extraLocs.length) parts.push('More locations (Bubble):\n' + c.extraLocs.map((l) => [l.name, l.address, l.lat != null ? `${l.lat}, ${l.lng}` : ''].filter(Boolean).join(' - ')).join('\n'));
  if (c.comments) parts.push(`Comments (Bubble): ${c.comments}`);
  if (c.attachments.length) parts.push('Attachments (Bubble links):\n' + c.attachments.join('\n'));
  return parts.join('\n\n') || null;
};

// --- Write the plan to the database (one transaction; safe to re-run) ---
async function runImport(client, plan, { actorId } = {}) {
  const res = { orgsCreated: 0, orgsReused: 0, boardsCreated: 0, boardsSkipped: 0, listsCreated: 0, cardsCreated: 0, usersCreated: 0, usersExisting: 0 };
  const unusableHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
  const uid = new Map();
  for (const p of plan.people.values()) {
    const ex = await client.query('SELECT id FROM users WHERE email = $1', [p.email]);
    if (ex.rows[0]) { uid.set(p.email, ex.rows[0].id); res.usersExisting++; continue; }
    const name = p.name || p.email.split('@')[0];
    const ins = await client.query('INSERT INTO users (name, email, password_hash, bubble_id) VALUES ($1,$2,$3,$4) RETURNING id', [name, p.email, unusableHash, p.bid || null]);
    uid.set(p.email, ins.rows[0].id); res.usersCreated++;
  }
  const U = (e) => (e ? uid.get(e) || null : null);

  for (const org of plan.orgs) {
    let orgId = null;
    if (org.bid) { const ex = await client.query('SELECT id FROM organizations WHERE bubble_id = $1', [org.bid]); if (ex.rows[0]) { orgId = ex.rows[0].id; res.orgsReused++; } }
    if (!orgId) {
      const slug = await uniqueSlug(org.name);
      const ins = await client.query('INSERT INTO organizations (name, slug, bubble_id) VALUES ($1,$2,$3) RETURNING id', [org.name, slug, org.bid]);
      orgId = ins.rows[0].id; res.orgsCreated++;
      for (const t of [['Hot', '#B5533C'], ['Normal', '#3AA0E0'], ['Low', '#6B7686']]) {
        await client.query('INSERT INTO tags (org_id, board_id, name, color) VALUES ($1, NULL, $2, $3)', [orgId, t[0], t[1]]);
      }
    }
    const roles = new Map();
    org.members.forEach((e) => roles.set(e, 'member'));
    org.admins.forEach((e) => roles.set(e, 'admin'));
    for (const [e, role] of roles) {
      if (!U(e)) continue;
      await client.query('INSERT INTO org_members (org_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT (org_id, user_id) DO NOTHING', [orgId, U(e), role]);
    }
    const firstAdmin = [...org.admins].map(U).find(Boolean) || actorId || null;

    for (const b of org.boards) {
      if (b.bid) {
        const ex = await client.query('SELECT 1 FROM boards WHERE bubble_id = $1', [b.bid]);
        if (ex.rows[0]) { res.boardsSkipped++; continue; }
      }
      const owner = U(b.admins[0]) || U(b.creator) || firstAdmin;
      const bi = await client.query('INSERT INTO boards (org_id, title, template, owner_id, bubble_id) VALUES ($1,$2,$3,$4,$5) RETURNING id', [orgId, b.title, 'blank', owner, b.bid]);
      const boardId = bi.rows[0].id; res.boardsCreated++;
      const perms = new Map();
      b.members.forEach((e) => perms.set(e, 'editor'));
      org.admins.forEach((e) => { if (b.unsorted) perms.set(e, 'owner'); });
      b.admins.forEach((e) => perms.set(e, 'owner'));
      for (const [e, perm] of perms) {
        if (!U(e)) continue;
        await client.query('INSERT INTO board_members (board_id, user_id, permission) VALUES ($1,$2,$3) ON CONFLICT (board_id, user_id) DO NOTHING', [boardId, U(e), perm]);
      }
      if (owner) await client.query("INSERT INTO board_members (board_id, user_id, permission) VALUES ($1,$2,'owner') ON CONFLICT (board_id, user_id) DO UPDATE SET permission = 'owner'", [boardId, owner]);

      let doneTag = null;
      for (let li = 0; li < b.lists.length; li++) {
        const l = b.lists[li];
        const lr = await client.query('INSERT INTO lists (board_id, name, position, bubble_id) VALUES ($1,$2,$3,$4) RETURNING id', [boardId, l.name, li, l.bid]);
        res.listsCreated++;
        l.cards.sort((a, c) => a.pos - c.pos);
        for (let ci = 0; ci < l.cards.length; ci++) {
          const c = l.cards[ci];
          const now = Date.now();
          const due = c.due;
          // Past dates are marked as already reminded so importing old tasks
          // can't fire hundreds of reminders at once.
          const remindAt = due ? new Date(due.getTime() - 60 * 60000) : null;
          const reminded = due && remindAt.getTime() <= now ? new Date() : null;
          const cr = await client.query(
            `INSERT INTO cards (list_id, name, notes, assigned_to, created_by, position,
                                follow_up_at, follow_up_remind_before, follow_up_remind_at, follow_up_reminded_at, follow_up_set_by,
                                created_at, updated_at, bubble_id, lat, lng, address)
             VALUES ($1,$2,$3,$4,$5,$6,$7,60,$8,$9,$10,COALESCE($11, NOW()),NOW(),$12,$13,$14,$15) RETURNING id`,
            [lr.rows[0].id, c.title, noteFor(c), U(c.assignees[0]), U(c.creator), ci, due, remindAt, reminded, due ? U(c.creator) : null, c.created, c.bid,
             c.loc ? c.loc.lat : null, c.loc ? c.loc.lng : null, c.loc ? (c.loc.address || c.loc.name || null) : null]
          );
          res.cardsCreated++;
          if (c.complete) {
            if (!doneTag) {
              const t = await client.query("INSERT INTO tags (org_id, board_id, name, color) VALUES ($1,$2,'Done','#5D8A66') RETURNING id", [orgId, boardId]);
              doneTag = t.rows[0].id;
            }
            await client.query('INSERT INTO card_tags (card_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [cr.rows[0].id, doneTag]);
          }
        }
      }
    }
  }
  return res;
}

// Load a batch's stored rows grouped by type (each row keeps Bubble's own headers).
async function loadBatchRows(db, batchId) {
  const { rows } = await db.query('SELECT type, data FROM bubble_import_rows WHERE batch_id = $1 ORDER BY id', [batchId]);
  const by = {};
  for (const r of rows) (by[r.type] = by[r.type] || []).push(r.data);
  return by;
}

module.exports = { parseCsv, detectType, buildPlan, runImport, loadBatchRows, parseBubbleDate, g };
