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

**If you're upgrading from before multi-tenancy specifically:** everything
that existed gets moved into one auto-created "Legacy Organization," and
every existing user account becomes a member of it with whatever role they
had before. Log in and you'll land right back where you were — the org
switcher will just show that one org until you create more.

## Multi-tenancy: organizations

TaskOrb runs as a real multi-tenant app now, not a single shared instance:

- **Self-serve signup** — anyone visiting `/register` creates a brand-new,
  fully isolated organization. If they sign up again later with the same
  email, that adds a second org to the *same account* instead of erroring
  (like joining a second Slack workspace with one login) — enter the
  existing password to confirm it's really them.
- **One account, many orgs** — a person can belong to several organizations
  and switch between them from the dropdown next to the logo. Whichever org
  is active determines which boards, cards, and team members you see —
  everything (boards, lists, cards, sharing, notifications, exports) is
  scoped to the active org and invisible from any other org.
- **Per-org roles**, not global ones — someone can be an `admin` in one org
  and a `member` in another. The old single global role is gone.
- **Team page** only adds people who already have a TaskOrb account
  (any org's, since accounts are self-service) — an org admin grants org
  access, but never sets someone else's password.

## User roles

| Org role (from Team page, per-org) | Board permission (from Share button) |
|---|---|
| **admin** — manages that org's roster, sees/manages every board in it | **owner** — manage sharing, rename/delete the board |
| **leader** — same board permissions as anyone else, plus can export | **editor** — add/move/edit cards and lists |
| **member** — default for everyone else | **viewer** — read-only |

These are two separate layers: your org role controls team management within
that org; your board permission controls what you can do on a specific
board. A `member` can still own boards they create.

## Platform admin (SaaS operator)

Separate from any org's own admins, a **platform admin** can see and enter
every organization on the deployment — meant for you as the operator
(support, billing, abuse handling), not for any customer.

To grant it: have that person register a normal account first, then set the
`PLATFORM_ADMIN_EMAIL` environment variable to their email and redeploy (or
re-run `npm run migrate`) — the migration promotes that account on its next
run. It can't be granted through the app itself, on purpose, so nobody can
self-escalate.

A platform admin gets a small icon next to the notification bell linking to
`/platform` — an overview of every org with a one-click "Enter as admin"
into any of them. Regular org admins never see this and stay blind to other
orgs' existence entirely.

## Data model (Postgres)

- `users` — name, email, password hash, platform-admin flag (accounts are
  independent of any org; the old global role column is unused/deprecated)
- `organizations` — the tenant boundary; everything below belongs to one
- `org_members` — who belongs to which org, and their role in it
- `boards` — title, description, template, owner, **which org it belongs to**
- `board_members` — who has access to a board and at what permission level
- `lists` — columns within a board
- `cards` — one row per task/prospect: contact info, lat/lng, notes,
  priority, assignment, which list it's in
- `card_attachments` — uploaded files, stored as `bytea`
- `notifications` — per-user, per-org notification feed
- `schema_migrations` — tracks which numbered migration files have run

## Production hardening

Status of the standard pre-launch checklist, in the order it's usually asked:

1. **Multi-tenancy** — done (see above).
2. **Authorization audit** — done. Every mutating route now requires
   `requireAuth` + an org-context gate (`requireOrg` for page loads,
   `requireOrgApi` for fetch-based routes — the split matters because a
   redirect breaks a JS `fetch()` call expecting JSON) + a board/org
   permission check where relevant. Board and card access is always
   verified against the *currently active org*, not just board membership,
   so a stale `board_members` row can never grant cross-org access. Sharing
   a board is restricted to people already in that org. Two real bugs were
   caught and fixed during this pass: JSON API routes were redirecting
   instead of erroring when org context was missing, and the `/users`
   admin-only gate was returning raw JSON instead of a proper error page.
3. **CSRF protection** — done, implemented by hand (`lib/csrf.js`) rather
   than a third-party package, since this environment can't install/verify
   a dependency's current API before shipping it. Classic synchronizer
   token: one random token per session, required on every mutating request
   either as a hidden `_csrf` form field or an `x-csrf-token` header.
   `public/js/csrf.js` patches `window.fetch` globally so none of the
   existing `fetch()` calls needed individual changes.
4. **Rate limiting** — done, via `express-rate-limit`. A generous global
   ceiling (600 req/15min/IP) plus a tighter one specifically on
   `/login` and `/register` (20/15min/IP) where brute-forcing actually
   matters.
5. **Session hardening** — done: session ID regenerates on login/register
   (prevents session fixation), cookie is `httpOnly` + `sameSite=lax`,
   sessions roll forward on activity, and the cookie name no longer
   advertises Express by default. **Heads up:** this rotates the cookie
   name, so everyone gets logged out once on this deploy.
6. **Database constraints** — tightened: `boards.org_id`, `notifications.org_id`,
   and `lists.board_id` are now `NOT NULL` at the database level (previously
   nullable only to allow the multi-tenancy backfill to run without a
   chicken-and-egg failure). CHECK constraints on roles/permissions/priority
   were already in place from earlier.
7. **Proper migration system** — done. `db/migrations/` holds numbered files,
   each run at most once and tracked in a `schema_migrations` table, instead
   of the old approach of re-checking "does this column exist" on every
   single deploy forever.
8. **Automated database backups** — script is ready
   (`npm run backup` → `db/backup.js`), but **not actually automated or
   off-server yet** — that needs two things only you can provide: (a)
   S3-compatible storage credentials (`S3_*` in `.env.example` — AWS S3,
   Cloudflare R2, and Backblaze B2 all have workable free tiers), since a
   backup written only to Render's local disk disappears on the next
   restart just like attachments would; and (b) a scheduler to actually run
   it periodically — Render's Cron Jobs feature, or a scheduled GitHub
   Actions workflow, or an external pinger hitting a protected endpoint.
   Until both are wired up, this is a manual on-demand tool, not a safety
   net.
9. **Error logging/monitoring** — done for the "logging" half: every error
   is logged with request context (route, user, org) to console, which
   Render's Logs tab captures — real, usable monitoring with zero setup.
   The "monitoring" half (aggregation, alerting, trends) is optional and
   activates itself if you set `SENTRY_DSN` (free tier: 5k events/month) —
   deliberately using only Sentry's two most stable long-standing API calls
   (`init`, `captureException`) rather than its Express-specific helpers,
   whose API has changed across SDK versions.
10. **Production/staging separation** — **not built**, documented instead:
    Render's free tier has historically allowed only one free Postgres
    database per account, so a second free `render.yaml` service definition
    might not actually be usable on your plan, and shipping a config that
    silently assumes otherwise seemed worse than just explaining the path.
    When you're ready: duplicate the web service in Render pointing at a
    `staging` git branch instead of `main`, attach a second Postgres
    database (same free-tier caveat applies), and give it its own
    `SESSION_SECRET`/`PLATFORM_ADMIN_EMAIL`. Test on the staging URL, then
    merge `staging` → `main` to ship to production. If your plan can't
    support a second database, a cheaper interim step is a `staging` branch
    deployed to a *second free web service sharing the same database* —
    real data isolation, but at least a place to verify a deploy doesn't
    crash before it hits production.

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
