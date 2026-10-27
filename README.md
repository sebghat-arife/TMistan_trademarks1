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
│  Admin → Import Center     │   admin JWT → SECURITY DEFINER    │  admin_* RPCs (0400/0500)    │
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

**Admin Data Management Center** (`/admin`, `docs/ADMIN_DATA_MANAGEMENT.md`, migration 0600): Data
Overview, Trademark Records, Trademark Images, Excel/CSV Imports, ZIP Image Imports, Import History,
Unmatched Images, Orphaned Files, Audit Log. Archive (reversible) vs. permanent delete (typed `DELETE`,
enforced server-side), delete-by-import-batch with real provenance, Storage cleanup queue, append-only
audit log. **Edit record** (migration 1100, `docs/ADMIN_DATA_MANAGEMENT.md` § 8) corrects a record in
place through `admin_update_trademark` — administrator check in the database, immutable-id update,
optimistic concurrency, duplicate gazette + serial refused, every change audited, and hand-corrected
fields are kept when the Excel file is imported again (the Import Center says how many).
The admin area is reached only by typing `/admin/login` — the public site has no Login button.

**Search — the landing page** (`/`, `web/src/components/search/SearchExperience.tsx` rendered by
`web/src/pages/HomePage.tsx`; `/search?…` redirects to `/?…` so old links keep working): one hero
with two modes behind a segmented control — *Search by Name or Details* (keyword box + collapsible
advanced search: trademark name, serial, applicant, application/registration number, class, gazette,
publication date range, application type, goods) and *Search by Image*. Every search is a URL
(`?q=…&cls=…&mode=image`), filters are applied by `search_trademarks` in Postgres, results are the
shared `TrademarkCard`/`ResultTable` components (mark print, name, serial, applicant, class, Gazette
Number, publication date, source page, *View record*). Application/registration-number filters need
migration 0700; until it is applied the fields are shown as *Not available yet* and the search still
runs. The hero photograph is a real, CC-BY-licensed picture of Darulaman Palace (`web/public/img/CREDITS.md`).

**Informational pages** (`/data-sources`, `/services`, `/contact`, `docs/CONTACT.md`): *Data Sources &
Methodology* (where the records come from, how they are organised, image/record matching, coverage,
the report disclaimer), *Trademark Research Services* (six research services offered through Masnad
Law Firm as inquiries — no prices, no promises) and *Contact & Feedback* (four inquiry categories with
category-specific fields; submissions go through `submit_contact_request`, migration 0800 — validated
and rate-limited in Postgres, stored in a private table nobody can read through the API; administrators
triage them under Admin → Inquiries). Until 0800 is applied the form announces itself as not available.

**Legal, Knowledge Center and Data Corrections** (`/legal`, `/knowledge-center`, `/data-corrections`,
`docs/CORRECTIONS.md`): the four policies (Terms, Privacy, Disclaimer, Intellectual Property — three of
them marked as drafts pending Masnad's approval) in a hub-plus-reader layout; six educational articles
with real screenshots of the interface, topic filters and a search box; and the Data Correction &
Verification form (`submit_correction_request`, migration 0900 — validated and rate-limited in
Postgres, private evidence bucket, `CR-` reference + e-mail status check, admin queue with status
history under Admin → Data Corrections). Until 0900 is applied the form announces itself as not
available. Visitors never write to `public.trademarks`.

**Search by Image** (`/?mode=image`, `docs/IMAGE_SEARCH.md`): a visitor drops a logo (or picks
one of the *Example searches*, which are real images already published in the database), the
browser computes a compact visual descriptor (the picture itself never leaves the tab) and Postgres
(pgvector, migration 0500) returns the most similar published marks — *Exact match* (≥ 85 %),
*Similar images* (≥ 55 %) or *Advanced search* (similar + refine by class / gazette / application type). The index is built by the
administrator from Import Center → *Visual search index*; images uploaded later are indexed
automatically. With migrations **1200 + 1300** applied (`supabase/APPLY_1300.sql`) and the stored
images analysed once, the same page switches to **intelligent mode — at $0/month**: the words in
the uploaded image are recognised *in the visitor's browser* (Tesseract.js, Latin + Persian/Pashto
script, ≈ 8 MB downloaded once and cached) and shown for correction, spelling and transliteration
variants are generated, and Postgres ranks the published marks by text similarity (names, printed
mark text and the words recognised in every stored image) combined with the near-duplicate
descriptor — results grouped as *Text match*, *Possible spelling or transliteration variant*,
*Visually similar* and *Similar symbol or composition*, each with its reasons. The stored images are
analysed in resumable batches from Import Center → *Text recognised in trademark images* (in the
administrator's browser) or with `tools/image_index` on a PC / free GitHub Codespace. No inference
server, no `VISION_API_URL`, no paid API. **Download Record** on a trademark page produces a real A4 PDF ("Trademark Publication
Report", fonts embedded, Dari/Pashto right-to-left) generated in the browser — no server, no
third-party service (`docs/PDF_REPORT.md`).

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
| `web/src/pages/admin/ImportCenterPage.tsx`, `web/src/lib/import/` | Admin Import Center: spreadsheet parsing/validation (official 21-column structure), image intake (ZIP, sniffing, hashing), serial matching | yes |
| `web/src/pages/admin/Admin*Page.tsx`, `web/src/services/admin_data_service.ts`, `web/src/components/admin/AdminUi.tsx` | Admin Data Management Center (records, images, history, storage, audit) — typed client for the 0600 RPCs, confirmation dialogs | yes |
| `web/src/pages/admin/TrademarkEditForm.tsx` | in-panel record editor (diff-only patch, validation, stale/duplicate conflict handling, unsaved-changes guard) — calls `admin_update_trademark` (migration 1100) | yes |
| `supabase/APPLY_ALL.sql` | all migrations concatenated (0100–1200) — paste once into the Supabase SQL editor of a new project | no |
| `supabase/APPLY_0400.sql` | migration 0400 alone (Import Center RPCs, serial index, storage policies) for projects already on 0100–0300 | no |
| `supabase/APPLY_0500.sql` | migration 0500 alone (Search by Image: pgvector table + functions) for projects already on 0100–0400 | no |
| `supabase/APPLY_0600.sql` | migration 0600 alone (Data Management: provenance columns, admin RPCs, audit tables, cleanup queue, public-API column grants) for projects already on 0100–0500 | no |
| `supabase/APPLY_0700.sql` | migration 0700 alone (search by application / registration number — function-only) for projects already on 0100–0600 | no |
| `supabase/APPLY_0800.sql` | migration 0800 alone (Contact & Feedback: private `contact_requests` table + submit/admin functions) for projects already on 0100–0600 (0700 not required) | no |
| `supabase/APPLY_0900.sql` | migration 0900 alone (Data Correction requests: two private tables, submit/status/admin functions, private evidence bucket + policies) for projects already on 0100–0600 (0700/0800 not required) | no |
| `supabase/APPLY_1000.sql` | migration 1000 alone (image re-upload fix: Storage cleanup queue never removes a file a current image row references, `admin_trademark_images_lookup`) for projects already on 0100–0600 (0700–0900 not required) | no |
| `supabase/APPLY_1100.sql` | migration 1100 alone (direct record editing: `admin_update_trademark` with optimistic concurrency + duplicate protection, `manual_edit_fields` provenance kept by later Excel imports) for projects already on 0100–0600 (0700–1000 not required) | no |
| `supabase/APPLY_1200.sql` | migration 1200 alone (intelligent Search by Image: `trademark_image_analysis` — recognised text per image, `text_match`/`phonetic_key`, `search_trademarks_hybrid`, `hybrid_image_search_status`, admin indexing RPCs) for projects already on 0100–0600 (0700–1100 not required) — superseded by `APPLY_1300.sql`, which contains it | no |
| `supabase/APPLY_1300.sql` | migrations 1200 **+** 1300 (zero-cost image analysis: `skipped` status, `engine`, `p_include_skipped`, coverage counters) for projects already on 0100–0600 — the file to paste for Search by Image | no |
| `tools/image_index/` | offline text indexer (native Tesseract, same language models as the browser) + browser-path evaluation harness; runs on a PC or GitHub Codespace, authenticates as the administrator | no |
| `web/public/ocr/tessdata/` | Tesseract language models (`eng`, `fas`, `pus`, gzip, ≈ 3.7 MB) served to browsers for Search by Image | no (part of the static site) |
| `supabase/migrations/` | source of truth for the schema: 0100 schema · 0200 search RPCs · 0300 RLS/grants · 0400 admin import · 0500 image search · 0600 data management · 0700 search by application/registration number · 0800 contact inquiries · 0900 data correction requests · 1000 image re-upload fix (cleanup-queue guard) · 1100 direct record editing (admin_update_trademark, manual-edit protection) · 1200 intelligent image search (analysis table, hybrid search, admin indexing) · 1300 zero-cost image analysis (`skipped` status, engine, coverage) | no |
| `importers/` | *optional* Python bulk tools (gazette image folders) — service-role key, operator machine | no |
| `scripts/setup_storage.py` | creates/verifies the Storage buckets (service-role key, run once) | no |
| `scripts/check_supabase.py` | end-to-end readiness check of the real project using only the public key | no |
| `scripts/local-stack/` | offline dev stack: PostgreSQL + PostgREST + static image server, no Supabase account needed | no |
| `docs/` | `DEPLOYMENT.md` (runbook), `SCHEMA.md`, `IMPORT_CENTER.md`, `ADMIN_DATA_MANAGEMENT.md`, `IMAGE_SEARCH.md`, `PDF_REPORT.md`, `LOVABLE_HANDOFF.md` | no |

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
| `trademark_image_features` (pgvector, RLS, no public policies), `search_trademarks_by_image()`, `image_search_status()`, `admin_image_index_status()`, `admin_images_missing_features()`, `admin_upsert_image_features()` | (0500) | Search by Image, Visual search index panel |

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
| `SITE_MASNAD_URL` | web build, optional | public website of Masnad Law Firm linked from the homepage and footer (default `https://www.masnadip.af/`; empty string = firm name without a link) |
| `SITE_CANONICAL_URL` | web build, optional | public origin printed in the PDF report (record link) and used for canonical links (default `https://www.tmistan.com`) |
| `NODE_VERSION` | Render build (set by `render.yaml`, also `web/.node-version`) | `22.12.0` — Vite 8 needs Node ≥ 20.19 / ≥ 22.12 |
| `PORT`, `ENVIRONMENT` | optional Docker image only | nginx listen port / label — not used by the static site |
| `SUPABASE_SERVICE_ROLE_KEY` | **importers only** (`importers/.env`) | bypasses RLS — never in the web app, never in the image |
| `SUPABASE_BUCKET` | importers | defaults to `trademark-images` |
| `VITE_LOCAL_STORAGE_BASE` | local dev stack only | `/local-storage` (static image server) |
| `TMISTAN_ADMIN_PASSWORD` | `tools/image_index` only, optional | administrator password for unattended offline indexing runs (otherwise prompted). `VISION_API_URL` and the former `tmistan-vision` service are obsolete and ignored — Search by Image needs no variable (`docs/IMAGE_SEARCH.md`) |

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
   It is the concatenation of `supabase/migrations/…0100` … `…0900`; additive and
   idempotent (safe to re-run), it never drops or rewrites `public.trademarks` rows and keeps the
   `(official_gazette_number, serial_number)` uniqueness. The result panel prints the post-checks
   (trademark count, gazettes, policies, anon-readable rows). A project that already has 0100–0300
   only needs **`supabase/APPLY_0400.sql`** (Import Center), one on 0100–0400 only
   **`supabase/APPLY_0500.sql`** (Search by Image), and one on 0100–0500 only
   **`supabase/APPLY_0600.sql`** (Admin Data Management), and one on 0100–0600 only
   **`supabase/APPLY_0700.sql`** (search by application / registration number), **`supabase/APPLY_0800.sql`**
   (Contact & Feedback inbox), **`supabase/APPLY_0900.sql`** (Data Correction requests) and **`supabase/APPLY_1000.sql`**
   (image re-upload fix — apply this one on every project that already has 0600). Read the *Messages* tab: a WARNING about
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
8. **Build the visual index** — Import Center → *Visual search index* → *Index N images*
   (`docs/IMAGE_SEARCH.md`). Until 0500 is applied the image search page reports itself unavailable;
   keyword search is unaffected.
9. **Data Management** — until 0600 is applied every `/admin` data-management page shows
   *"Migration 0600 has not been applied"*; paste `supabase/APPLY_0600.sql` (after a backup) and
   re-run `scripts/check_supabase.py` (section 2d). See `docs/ADMIN_DATA_MANAGEMENT.md`.
10. **Search by application / registration number** — until 0700 is applied the two fields in
   Advanced search read *Not available yet* and the app silently searches without them (it detects
   the missing parameters at runtime); paste `supabase/APPLY_0700.sql` (function-only, no data touched).
11. **Contact & Feedback** — until 0800 is applied `/contact` shows *"The inquiry form is not available
   yet"* and Admin → Inquiries shows *"Migration 0800 has not been applied"*; paste
   `supabase/APPLY_0800.sql` (one new private table + functions, nothing existing touched). Then set the
   approved contact details (`SITE_CONTACT_EMAIL` / `SITE_CONTACT_PHONE` / `SITE_CONTACT_ADDRESS`) as
   Render environment variables if Masnad wants them published — nothing is shown until they are set.
   See `docs/CONTACT.md`.
12. **Data Correction & Verification requests** — until 0900 is applied `/data-corrections` shows
   *"The request form is not available yet"* and Admin → Data Corrections shows *"Migration 0900 has not
   been applied"*; paste `supabase/APPLY_0900.sql` (two new private tables + functions + the private
   `correction-evidence` bucket and its policies, nothing existing touched). If the result panel reports
   `bucket correction-evidence = 0`, run `python3 scripts/setup_storage.py` once and re-run the file.
   See `docs/CORRECTIONS.md`.
13. **Intelligent Search by Image ($0)** — paste `supabase/APPLY_1300.sql` (migrations 1200 + 1300:
   one new table + functions, nothing existing touched) and analyse a first small batch from Import
   Center → *Text recognised in trademark images* (runs in your browser), then the rest from the
   panel or with `python -m tools.image_index --login <admin e-mail> index --all` on a PC. No
   service to deploy and no variable to set. Until then the page keeps working in basic
   (near-duplicate) mode. See `docs/IMAGE_SEARCH.md`.

Status of the production project `tzzslhpqbfjklazihssc` (checked 2026-10-12, read-only):
0100–0600 applied by the project owner (`registration_number`/`application_number` columns and the
admin data-management functions exist); 159 published trademarks in 2 gazettes with 159 indexed
images. **0700 (`APPLY_0700.sql`), 0800 (`APPLY_0800.sql`) and 0900 (`APPLY_0900.sql`) have not been
applied yet** — paste 0700 when the application / registration-number filters are wanted (step 10),
0800 to switch on the contact form (step 11) and 0900 to switch on the data-correction form (step 12);
all three are additive and independent of each other. **1000 (`APPLY_1000.sql`) should be applied now**
(checked 2026-10-14: 57 of the 60 pending Storage-cleanup entries point at images that were re-uploaded
after a deletion; the migration marks them `skipped` so a cleanup run can no longer remove live files).
Do not press *Remove queued files* on `/admin/storage` before the migration is in.

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
   `SITE_TWITTER_URL`, `SITE_LINKEDIN_URL` (footer; hidden when absent); `SITE_MASNAD_URL` (Masnad Law
   Firm website, defaults to `https://www.masnadip.af/`).
   Do **not** add `SUPABASE_SERVICE_ROLE_KEY` — the frontend never uses it.
4. **Apply / Deploy**. Build log should end with `✓ built in …` and "Your site is live".
5. **SPA rewrite** — already declared in `render.yaml` (`routes: rewrite /* → /index.html`).
   For a hand-made service: Redirects/Rewrites → Add rule → Source `/*`, Destination `/index.html`, Action **Rewrite**.
6. **Verify** — open `https://tmistan.onrender.com` (or your name): the home page shows the real
   counts from the database; reload `/?q=<a mark you imported>` and
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
- Data Management (0600): destructive RPCs require the typed token `DELETE` **in SQL**, delete only the
  ids passed, enqueue Storage paths for cleanup in the same transaction and write an append-only
  `admin_actions` row; `admin_actions`/`audit_logs` reject UPDATE/DELETE even from the owner. Column-level
  grants hide attorney, review notes and source file/sheet/row from the public API.
- Forms (0800 Contact, 0900 Data Corrections): the tables have RLS with **no policies and no grants**, so
  anonymous reads return nothing even with the publishable key; the only way in is a `SECURITY DEFINER`
  submit function that validates, rate-limits (per e-mail, per hashed IP, global) and never touches
  `public.trademarks`. Evidence goes to the private `correction-evidence` bucket through a policy gated
  by `correction_upload_allowed()` (15-minute window, 3 files, name pattern); administrators read it via
  signed URLs. Admin queue functions call `admin_assert()` first and audit every status change.
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
- Every trademark shows gazette / page provenance publicly; file / sheet / row, attorney and review notes are administrator-only.
- Deleting an image never deletes a trademark; deleting an import record never deletes records; nothing is deleted automatically.
- Schema changes only via explicit migrations; existing records and the gazette+serial uniqueness are preserved.
