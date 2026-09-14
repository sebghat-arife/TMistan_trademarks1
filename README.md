# TMistan — Afghanistan Trademark Registry

Public search platform for trademark records published in the Afghanistan Official Gazette.
**Supabase is the single source of truth**: the web app never ships mock data, never keeps a
parallel copy of the dataset and never filters the whole registry in the browser — every list,
search, filter and statistic is a database query.

```
┌────────────────────────────┐   HTTPS (publishable key + RLS)   ┌──────────────────────────────┐
│  Browser                   │ ────────────────────────────────▶ │  Supabase project            │
│  React SPA (web/)          │   PostgREST  /rest/v1/rpc/*       │  Postgres  public.trademarks │
│  static files on           │   Storage    /storage/v1/object   │            gazettes, images… │
│  Render Static Site (CDN)  │ ◀──────────────────────────────── │  Storage   trademark-images  │
│  Admin → Import Center     │   admin JWT → SECURITY DEFINER    │  admin_* RPCs (0400)         │
└────────────────────────────┘   RPCs + RLS storage policies     └──────────────▲───────────────┘
                                                                                 │ service-role key
                                                    ┌────────────────────────────┴───────────────┐
                                                    │  Operator tools (never deployed, never in   │
                                                    │  the browser): setup_storage, check script, │
                                                    │  optional Python importers, migrations      │
                                                    └─────────────────────────────────────────────┘
```

**Data gets in through Admin → Import Center** (`docs/IMPORT_CENTER.md`): an administrator drops
the registry Excel/CSV, reviews the validation, imports, then drops the trademark images (or a ZIP)
named `<serial>.png`; they are matched by serial number, stored in Supabase Storage, linked in
`trademark_images` and visible in the public search immediately. The record count is whatever the
imported files contain — nothing is assumed or seeded.

There is **no application server** — nothing to keep running, no `PORT`, no health endpoint. The
build output (`web/dist`) is plain static files served by Render's CDN; authorisation is decided by
Row Level Security in Postgres, so the only key in the browser is the public (publishable) key. The
service-role key exists only on the machine that runs importers / the storage setup script.

## Repository layout

| Path | What | Deployed to Render? |
|---|---|---|
| `web/` | React 19 + TypeScript + Vite + Tailwind SPA (the product) | **yes** (built to static files) |
| `web/src/services/` | the centralised data-access layer — the *only* place that talks to Supabase | yes |
| `render.yaml` | **Render Blueprint — Static Site** (root `web`, `npm ci && npm run build`, publish `dist`, SPA rewrite) | — |
| `Dockerfile`, `deploy/nginx.conf.template`, `.dockerignore` | *optional* container image for Docker hosts (Railway, Fly…) — not needed for Render | — |
| `web/src/pages/admin/ImportCenterPage.tsx`, `web/src/lib/import/` | Admin Import Center: spreadsheet parsing/validation, image intake (ZIP, sniffing, hashing), serial matching | yes |
| `supabase/APPLY_ALL.sql` | all migrations concatenated (0100–0400) — paste once into the Supabase SQL editor of a new project | no |
| `supabase/APPLY_0400.sql` | migration 0400 alone (Import Center RPCs, serial index, storage policies) for projects already on 0100–0300 | no |
| `supabase/migrations/` | source of truth for the schema: 0100 schema · 0200 search RPCs · 0300 RLS/grants · 0400 admin import | no |
| `importers/` | *optional* Python bulk tools (gazette image folders) — service-role key, operator machine | no |
| `scripts/setup_storage.py` | creates/verifies the Storage buckets (service-role key, run once) | no |
| `scripts/check_supabase.py` | end-to-end readiness check of the real project using only the public key | no |
| `scripts/local-stack/` | offline dev stack: PostgreSQL + PostgREST + static image server, no Supabase account needed | no |
| `docs/` | `DEPLOYMENT.md` (runbook), `SCHEMA.md`, `LOVABLE_HANDOFF.md` | no |

## Data model used by the app

Discovered from the live project + `supabase/migrations`:

| Object | Kind | Used for |
|---|---|---|
| `trademarks` | table (exists in the live project; 24 original columns untouched) | detail page, serial lookup |
| `gazettes`, `gazette_summaries` | table + view (migration 0100) | gazettes list, per-gazette counts |
| `trademark_images`, `trademark_primary_images` | table + view (0100) | images per trademark, card thumbnails |
| `search_trademarks(...)` | RPC (0200) — trigram + full-text, case/diacritic-insensitive, partial match, Arabic-Indic digits, paginated, sorted, returns `total_count` | search page, all list/filter helpers |
| `registry_stats()`, `recent_trademarks()`, `trademarks_by_class()`, `trademark_filter_options()`, `similar_trademarks()` | RPCs (0200) | home stats, recent list, admin chart, filter dropdowns, "similar" strip |
| `import_jobs`, `import_job_items`, `audit_logs`, `user_roles`, `is_admin()` | admin-only under RLS (0100/0300) | admin dashboard, Recent Imports |
| `admin_import_trademark_rows()`, `admin_resolve_serials()`, `admin_register_images()`, `admin_create/finish_import_job()`, `admin_add_import_items()`, `admin_trademarks_without_images()` | SECURITY DEFINER RPCs (0400), admin-only | Import Center |
| `trademarks_serial_number_key` (unique `serial_number`, guarded), `serial_canonical()` | (0400) | idempotent imports, image matching |
| Storage bucket `trademark-images` (public read, admin write via 0400 policies) | (0300/0400) | image URLs, Import Center uploads |

Dates are stored exactly as printed in the gazette — Afghan **Solar Hijri** (e.g. `1389-12-29`).
`public.to_gregorian_date()` converts for date filters/sorting; the UI shows both calendars in
English and the Solar Hijri calendar natively in Dari/Pashto. If the schema is ever missing the UI
shows a "Database not ready" error state — it never falls back to fake data.

## Environment variables

Real values live only in git-ignored files (`web/.env.local`, `importers/.env`) or in the hosting
platform's variables. `.env.example` files contain placeholders only.

| Variable | Where | Purpose |
|---|---|---|
| `SUPABASE_URL` | web build (Render environment variable / Docker build-arg) | `https://<ref>.supabase.co` — public |
| `SUPABASE_PUBLISHABLE_KEY` | web build | publishable (`sb_publishable_…`) or legacy anon JWT — public by design; the build **refuses** a `sb_secret_`/service-role key |
| `SITE_CONTACT_EMAIL` `SITE_CONTACT_PHONE` `SITE_CONTACT_ADDRESS` `SITE_FACEBOOK_URL` `SITE_TWITTER_URL` `SITE_LINKEDIN_URL` | web build, optional | footer contact / social links (hidden when unset) |
| `NODE_VERSION` | Render build (set by `render.yaml`, also `web/.node-version`) | `22.12.0` — Vite 8 needs Node ≥ 20.19 / ≥ 22.12 |
| `PORT`, `ENVIRONMENT` | optional Docker image only | nginx listen port / label — not used by the static site |
| `SUPABASE_SERVICE_ROLE_KEY` | **importers only** (`importers/.env`) | bypasses RLS — never in the web app, never in the image |
| `SUPABASE_BUCKET` | importers | defaults to `trademark-images` |
| `VITE_LOCAL_STORAGE_BASE` | local dev stack only | `/local-storage` (static image server) |

Legacy names `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_ANON_KEY` are still accepted as aliases.

## Local development

### A) Against the real Supabase project (recommended)

```bash
cd web
cp .env.example .env.local          # fill SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY (public key only)
npm ci
npm run dev                          # http://localhost:5173
```

Verify the project is ready (schema applied, RLS lets visitors read, bucket exists):

```bash
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
  python3 scripts/check_supabase.py
```

### B) Fully offline stack (PostgreSQL 17 + PostgREST + static storage)

```bash
scripts/local-stack/start.sh                                   # DB on 54329, applies ALL migrations, writes keys.env
~/.local/bin/postgrest scripts/local-stack/postgrest.conf &      # API on 54321
python3 scripts/local-stack/static_storage.py local-storage 54322 &
# data: sign in to /admin (see keys.env / mint_jwt.py) and use the Import Center, exactly like production
# web/.env.local:  SUPABASE_URL=/supabase  SUPABASE_PUBLISHABLE_KEY=<LOCAL_ANON_KEY from keys.env>  VITE_LOCAL_STORAGE_BASE=/local-storage
cd web && npm run dev
```

Quality gates: `cd web && npx tsc -b && npm run lint && npm run build`.

## Supabase configuration (one-time, done by a project owner)

1. **Backup** (Dashboard → Database → Backups).
2. **Schema** — SQL Editor → New query → paste the whole of `supabase/APPLY_ALL.sql` → Run.
   It is the concatenation of `supabase/migrations/…0100` … `…0400`; additive and
   idempotent (safe to re-run), it never drops or rewrites `public.trademarks` rows and keeps the
   `(official_gazette_number, serial_number)` uniqueness. The result panel prints the post-checks
   (trademark count, gazettes, policies, anon-readable rows). A project that already has 0100–0300
   only needs **`supabase/APPLY_0400.sql`** (Import Center). Read the *Messages* tab: a WARNING about
   `trademarks_serial_number_key` means duplicated serial numbers exist and must be fixed.
   Do **not** run `…0000_baseline…` or `supabase/dev/00_supabase_shim.sql` — those only emulate Supabase for the offline stack.
3. **Storage buckets** — from a trusted machine with `importers/.env` filled in:
   `python3 scripts/setup_storage.py` (creates `trademark-images` public + `source-documents` private).
   Buckets are created through the Storage API because the SQL editor role can no longer create
   `storage.objects` policies on hosted Supabase.
4. **Verify** — `python3 scripts/check_supabase.py` must print *All checks passed* (section 2b
   confirms the Import Center functions; `--expect-rows N` pins the count you expect after your imports).
5. **Admin users**: Authentication → Add user (auto-confirm), then
   `insert into public.user_roles (user_id, role) select id, 'admin' from auth.users where email = '<e-mail>';`
6. **Auth → URL configuration**: add the deployed origin (needed for admin login).
7. **Load the data** — sign in, Admin → Import Center, follow `docs/IMPORT_CENTER.md`.

Status of the production project `tzzslhpqbfjklazihssc`: 0100–0300 applied 2026-09-12, 12 gazette
files loaded, RLS verified; **0400 must be pasted by the project owner** (see `docs/IMPORT_CENTER.md` §1).

## Optional Python importer (operator machine, service-role key)

Normal operation does not need this — the Import Center covers spreadsheets and images from the
browser. `image_importer.py` remains for bulk-loading whole gazette image folders from a machine:

```bash
cd importers && cp .env.example .env         # SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + SUPABASE_BUCKET
pip install -r requirements.txt
python3 image_importer.py --root /path/to/images --gazette 1011 --dry-run --verbose   # report only
python3 image_importer.py --root /path/to/images                                      # idempotent; re-run = "skipped"
```

Images are matched **only** by serial number (`<serial>.<ext>`, same rule as the Import Center);
unmatched/ambiguous files are parked for review and never shown publicly. Every run is recorded in
`import_jobs` / `import_job_items`. See `docs/DEPLOYMENT.md §5`.

## Deploying to Render (Static Site) — exact steps

1. Push this repository to GitHub (never commit `.env*` — only the `*.example` files are tracked).
2. Render Dashboard → **New +** → **Blueprint** → connect the repository → Render reads `render.yaml`
   and shows one service **tmistan** (type *Static Site*).
   *Doing it by hand instead?* New + → **Static Site** and enter exactly:
   | Setting | Value |
   |---|---|
   | Root Directory | `web` |
   | Build Command | `npm ci && npm run build` |
   | Publish Directory | `dist` |
3. **Environment variables** (Render asks for them during Blueprint setup; otherwise service → Environment):
   | Key | Value |
   |---|---|
   | `SUPABASE_URL` | `https://<your-project-ref>.supabase.co` |
   | `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` (the **publishable** key — never `sb_secret_…`) |
   | `NODE_VERSION` | `22.12.0` (already in `render.yaml`) |
   Optional: `SITE_CONTACT_EMAIL`, `SITE_CONTACT_PHONE`, `SITE_CONTACT_ADDRESS`, `SITE_FACEBOOK_URL`,
   `SITE_TWITTER_URL`, `SITE_LINKEDIN_URL` (footer; hidden when absent).
   Do **not** add `SUPABASE_SERVICE_ROLE_KEY` — the frontend never uses it.
4. **Apply / Deploy**. Build log should end with `✓ built in …` and "Your site is live".
5. **SPA rewrite** — already declared in `render.yaml` (`routes: rewrite /* → /index.html`).
   For a hand-made service: Redirects/Rewrites → Add rule → Source `/*`, Destination `/index.html`, Action **Rewrite**.
6. **Verify** — open `https://tmistan.onrender.com` (or your name): the home page shows the real
   counts from the database; reload `/search?q=<a mark you imported>`, `/gazettes`,
   `/trademark/<serial>` directly (no 404 thanks to the rewrite).
7. Add the Render URL to Supabase → Authentication → URL configuration (for the admin login), then
   sign in at `/admin/login` and load the registry through the Import Center.

Changing a variable later → Render rebuilds automatically (values are inlined at build time).

### Optional: Docker image (Railway, Fly, any container host)

```bash
docker build --build-arg SUPABASE_URL=https://<ref>.supabase.co --build-arg SUPABASE_PUBLISHABLE_KEY=sb_publishable_... -t tmistan .
docker run --rm -p 8080:8080 -e PORT=8080 tmistan      # nginx, SPA fallback, /healthz
```

## Security model (reviewed)

- Browser holds only the publishable key; RLS policies (`0300`) allow anonymous **read** of
  `trademarks`/`gazettes`/`trademark_images`, nothing else; all writes and `import_jobs`/`audit_logs`
  are admin-only via `is_admin()`. Verified: anon `INSERT` → 401/403, `import_jobs` → permission denied.
- `0300` also **revokes** the default hosted-Supabase grants: `anon` has no INSERT/UPDATE/DELETE on any
  table and no access at all to `import_jobs`, `audit_logs`, `user_roles`; `authenticated` can never DELETE.
  Verified live: anon INSERT/UPDATE/DELETE → 401, `user_roles` self-promotion → 401, admin-only tables → 401.
- Storage: `trademark-images` is a public-read bucket; the only write policies (0400) require the
  `authenticated` role **and** `is_admin()`, so anonymous/non-admin uploads are refused (verified: anonymous upload → 400/403).
- Import Center: every privileged step is a `SECURITY DEFINER` RPC that calls `admin_assert()` first
  (whitelisted columns, capped batch sizes, per-row error isolation); `EXECUTE` is revoked from `anon`.
- `vite.config.ts` and the `Dockerfile` reject `sb_secret_*` / service-role JWTs as the public key; the built
  bundle is grepped for `sb_secret_`, `service_role`, `SUPABASE_SERVICE_ROLE_KEY` (zero hits).
- `.gitignore` excludes every `.env*` except `*.example`; `render.yaml` never references the secret key.
- Static site headers (`render.yaml`): `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`; hashed assets immutable-cached.
- No `dangerouslySetInnerHTML`, no `eval`; user input reaches Postgres only as RPC parameters (parameterised by PostgREST).

## Non-negotiables encoded in the code

- No mock data, no second database, no client-side filtering of the dataset — `search_trademarks` does the work server-side.
- Every screen has explicit **loading / empty / error** states; a missing schema is reported as "Database not ready", never hidden.
- Detail page renders only fields that exist and are non-null; images come from `trademark_images` or a neutral placeholder — never a fabricated logo.
- Images: bytes in Storage, metadata in `trademark_images`, matched only by the serial number in the file name — never guessed (ambiguous = not uploaded).
- No demo/seed dataset anywhere: the registry contains exactly what administrators import.
- Every trademark shows gazette / page / file / sheet / row provenance.
- Schema changes only via explicit migrations; existing records and the gazette+serial uniqueness are preserved.
