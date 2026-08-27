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
CREATE TABLE IF NOT EXISTS organizations (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT UNIQUE NOT NULL,
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
  priority        TEXT DEFAULT 'warm' CHECK (priority IN ('hot','warm','cold')),
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
