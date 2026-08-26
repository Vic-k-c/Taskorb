# TaskOrb

Multi-board, map-enabled kanban. Create as many boards as you need — soul
winning, a marketing pipeline, an online class roster, a plain to-do list, or
a blank board for anything else — share each one with specific people at
specific permission levels, and log new cards either directly on a board or
by tapping a spot on a map (useful for door-to-door / location-based work).
Includes login with org-level roles, in-app notifications, and PDF/CSV
export.

## Stack

- **Backend:** Node.js + Express, server-rendered with EJS
- **Database:** PostgreSQL (plain SQL via `pg`, no ORM)
- **Auth:** `express-session` (stored in Postgres) + `bcryptjs`
- **Map:** Leaflet.js + OpenStreetMap / Esri satellite tiles (free, no API key)
- **Board:** SortableJS for drag-and-drop
- **File uploads:** `multer` (in-memory) → stored as bytea rows in Postgres
- **PDF export:** `pdfkit`

## How the pieces fit together

- **Boards** are the top-level container. Each has a title, a description,
  and a permission list. Create one from **Boards → Create a board**, or
  create one on the fly from the map popup.
- **Templates** just pre-fill a board's starting lists (Soul Winning,
  Marketing Pipeline, Online Classes, Simple To-Do, or Blank). Every list is
  fully editable/removable afterward — the template is a starting point, not
  a locked structure.
- **Sharing**: a board's **owner** can add anyone from the team at `owner`,
  `editor`, or `viewer` level from the Share button on the board page.
  `editor` can add/move/edit cards and lists; `viewer` is read-only.
  Org-level **admins** (see Roles below) can see and manage every board
  regardless of membership, for oversight.
- **Map** is global — open it from the nav, tap anywhere, and the popup form
  lets you either drop the card into an existing board+list or create a new
  board/list right there inline. Address auto-fills via reverse geocoding.
  You can attach photos, PDFs, or short videos to a card either from the map
  popup or from the card's detail modal on the board.
- **Notifications**: you get one when someone assigns you to a card, moves a
  card assigned to you, or adds you to a board. The bell in the nav polls
  every 20 seconds; opening it marks everything read.

## One important scoping note on attachments

Files are stored **in the Postgres database** (as `bytea`), not on local
disk. This is deliberate: Render's free-tier filesystem is wiped on every
restart/redeploy, so anything written to disk would vanish. Database storage
works fine for a prototype but isn't the long-term answer for large volumes
of video — see "What I'd extend first" below.

## Run it locally

1. Install Node 18+ and a local Postgres (or use a free hosted one from
   [Neon](https://neon.tech) or [Supabase](https://supabase.com)).
2. `cd taskorb && npm install` (folder may still be named `church-canvass`
   depending on how you unzipped it — that's just the folder name, doesn't
   affect anything).
3. Copy `.env.example` to `.env` and fill in `DATABASE_URL` and `SESSION_SECRET`.
4. Create/upgrade the schema:
   ```
   npm run migrate
   ```
5. Start the app:
   ```
   npm start
   ```
6. Open `http://localhost:3000/register` to create your first (admin)
   account, since no users exist yet. Log in, then create your first board
   from **Boards**, or go straight to **Map** and create one inline by
   tapping a spot.

## Deploy to Render

**Option A — Blueprint (fastest):**
1. Push this folder to a GitHub repo — make sure `package.json` ends up at
   the **repo root** (or set Render's "Root Directory" setting to the
   subfolder it's in).
2. In Render, **New → Blueprint**, point it at the repo. `render.yaml`
   provisions the web service and a free Postgres database together and
   wires up `DATABASE_URL` and `SESSION_SECRET` automatically.
3. Click **Apply** — first deploy runs `npm run migrate` before starting the
   server.
4. Open the URL Render gives you and go to `/register`.

**Option B — Manual:**
1. Push to GitHub.
2. **New → PostgreSQL** (free tier) → copy the **Internal Database URL**.
3. **New → Web Service** → connect the repo → Build command `npm install` →
   Start command `npm run migrate && npm start`.
4. Environment variables: `DATABASE_URL` (the Internal URL from step 2),
   `SESSION_SECRET` (any long random string), `NODE_ENV=production`.
5. Deploy.

If you're upgrading an **existing** deployment of the earlier single-board
version of this app, `npm run migrate` handles it automatically: it adds the
new `boards`/`board_members`/`notifications`/`card_attachments` tables,
renames the old `interest_level` column to `priority`, and sweeps any
pre-existing lists into a new "My Board" that gets assigned to your earliest
admin account. No manual data migration needed.

## User roles

| Org role (from Team page) | Board permission (from Share button) |
|---|---|
| **admin** — manages the team roster, sees/manages every board | **owner** — manage sharing, rename/delete the board |
| **leader** — same board permissions as anyone else, plus can export | **editor** — add/move/edit cards and lists |
| **member** — default for everyone else | **viewer** — read-only |

These are two separate layers: your org role controls team management and
oversight; your board permission controls what you can do on a specific
board. A `member` can still own boards they create.

## Data model (Postgres)

- `users` — name, email, password hash, org role
- `boards` — title, description, template, owner
- `board_members` — who has access to a board and at what permission level
- `lists` — columns within a board
- `cards` — one row per task/prospect: contact info, lat/lng, notes,
  priority, assignment, which list it's in
- `card_attachments` — uploaded files, stored as `bytea`
- `notifications` — per-user notification feed

## What I'd extend first

1. **Move attachments to object storage** (S3, Cloudinary, or Render Disks)
   once file volume grows — the in-database approach here is simple and
   zero-config but won't scale to lots of large video files.
2. **Real rooftop detection on the map.** Add a building-footprint layer
   (Overture Maps or Microsoft Building Footprints, both free/open) and snap
   taps to the nearest building polygon instead of the raw click point.
3. **Territory assignment** — draw polygons on the map (Leaflet.draw) to
   carve up areas and assign them to a person or team.
4. **Per-address visit history**, separate from the card record, so
   "not home, try again Tuesday" doesn't get lost the next time someone logs
   the same address.
5. **Offline-first mobile support** — a service worker that queues card
   submissions locally and syncs when back online, useful for canvassers in
   spotty signal.
6. **Card comments/activity feed**, so multiple people working the same card
   can see what's already been tried, beyond just the notes field.
7. **Push notifications** (not just in-app) via a service worker + Web Push,
   so people don't have to have the tab open to get notified.
