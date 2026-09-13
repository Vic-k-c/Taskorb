-- TaskOrb schema

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','leader','member')), -- deprecated: role is now per-org, see org_members. Column kept (unused) to avoid a destructive drop before backups exist.
  default_template TEXT DEFAULT 'blank',
  is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE, -- platform operator, not tied to any single org; see PLATFORM_ADMIN_EMAIL in README
  created_at    TIMESTAMP DEFAULT NOW()
);

-- One TaskOrb account can belong to many organizations, each with its own role.
-- Plan limits/features/prices live in lib/plans.js, not here -- this table
-- exists only so organizations.plan_key has referential integrity and SQL
-- reports can join to a readable name.
CREATE TABLE IF NOT EXISTS plans (
  key  TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
INSERT INTO plans (key, name) VALUES
  ('free', 'Free'),
  ('individual', 'Individual'),
  ('team_starter', 'Team Starter'),
  ('team', 'Team'),
  ('team_growth', 'Team Growth'),
  ('team_business', 'Team Business')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS organizations (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT UNIQUE NOT NULL,
  plan_key   TEXT NOT NULL DEFAULT 'free' REFERENCES plans(key),
  billing_cycle TEXT CHECK (billing_cycle IN ('monthly','annual')),
  -- none = never subscribed; trial = in a free trial; active = paid and
  -- current; grace = payment failed but still within the grace window
  -- (full access); canceled = access continues until current_period_end,
  -- then lazily reverts to free.
  subscription_status TEXT NOT NULL DEFAULT 'none' CHECK (subscription_status IN ('none','trial','active','grace','canceled')),
  trial_ends_at TIMESTAMP,
  has_used_trial BOOLEAN NOT NULL DEFAULT FALSE,
  trial_reminder_sent_at TIMESTAMP,
  paystack_customer_code TEXT,
  paystack_subscription_code TEXT,
  paystack_email_token TEXT,
  current_period_end TIMESTAMP,
  grace_period_ends_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS org_members (
  org_id     INT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','leader','member')),
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members(user_id);

-- A board is any purpose-built kanban: soul winning, marketing pipeline,
-- a class roster, a to-do list, etc. `template` just remembers what it was
-- created from (for an icon/label) -- lists are fully editable afterward.
CREATE TABLE IF NOT EXISTS boards (
  id            SERIAL PRIMARY KEY,
  org_id        INT REFERENCES organizations(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT,
  template      TEXT DEFAULT 'blank',
  owner_id      INT REFERENCES users(id) ON DELETE SET NULL,
  cover_mime_type TEXT,
  cover_data    BYTEA,
  created_at    TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_boards_org_id ON boards(org_id);

-- Per-board sharing. permission: owner > editor > viewer.
CREATE TABLE IF NOT EXISTS board_members (
  board_id   INT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL DEFAULT 'editor' CHECK (permission IN ('owner','editor','viewer')),
  added_at   TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (board_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_board_members_user ON board_members(user_id);

-- Trello-style labels. board_id NULL = org-wide (admin-managed, available on
-- every board in the org); board_id set = a custom tag scoped to just that
-- one board (any editor+ of that board can create one).
CREATE TABLE IF NOT EXISTS tags (
  id         SERIAL PRIMARY KEY,
  org_id     INT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  board_id   INT REFERENCES boards(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#3AA0E0',
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tags_org ON tags(org_id);
CREATE INDEX IF NOT EXISTS idx_tags_board ON tags(board_id);

CREATE TABLE IF NOT EXISTS lists (
  id       SERIAL PRIMARY KEY,
  board_id INT REFERENCES boards(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  position INT NOT NULL
);

CREATE TABLE IF NOT EXISTS cards (
  id              SERIAL PRIMARY KEY,
  list_id         INT REFERENCES lists(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  phone           TEXT,
  email           TEXT,
  address         TEXT,
  lat             DOUBLE PRECISION,
  lng             DOUBLE PRECISION,
  notes           TEXT,
  priority        TEXT DEFAULT 'warm' CHECK (priority IN ('hot','warm','cold')), -- deprecated: replaced by the tags/card_tags system below. Column kept (unused) to avoid a destructive drop before backups exist.
  assigned_to     INT REFERENCES users(id) ON DELETE SET NULL,
  created_by      INT REFERENCES users(id) ON DELETE SET NULL,
  position        INT DEFAULT 0,
  cover_attachment_id INT,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cards_list_id ON cards(list_id);
CREATE INDEX IF NOT EXISTS idx_cards_latlng ON cards(lat, lng);
CREATE INDEX IF NOT EXISTS idx_lists_board_id ON lists(board_id);

CREATE TABLE IF NOT EXISTS card_tags (
  card_id INT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  tag_id  INT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (card_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_card_tags_tag ON card_tags(tag_id);

-- File attachments live in the database (not local disk) because Render's
-- free-tier filesystem is wiped on every restart/redeploy. Fine for a
-- prototype; move to S3/Cloudinary if attachment volume grows.
CREATE TABLE IF NOT EXISTS card_attachments (
  id          SERIAL PRIMARY KEY,
  card_id     INT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  size_bytes  INT NOT NULL,
  data        BYTEA NOT NULL,
  uploaded_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_attachments_card_id ON card_attachments(card_id);

CREATE TABLE IF NOT EXISTS billing_transactions (
  id                 SERIAL PRIMARY KEY,
  org_id             INT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  paystack_reference TEXT UNIQUE,
  plan_key           TEXT,
  billing_cycle      TEXT,
  type               TEXT NOT NULL CHECK (type IN ('subscription_start','renewal','upgrade','downgrade','cancel','other')),
  amount_usd         NUMERIC(10,2),
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed')),
  raw_event          JSONB,
  created_at         TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_billing_tx_org ON billing_transactions(org_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_tx_reference ON billing_transactions(paystack_reference) WHERE paystack_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS notifications (
  id         SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id     INT REFERENCES organizations(id) ON DELETE CASCADE,
  message    TEXT NOT NULL,
  link       TEXT,
  read       BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);

-- session store table (used by connect-pg-simple)
CREATE TABLE IF NOT EXISTS "session" (
  "sid"    varchar NOT NULL COLLATE "default",
  "sess"   json NOT NULL,
  "expire" timestamp(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
