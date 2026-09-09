# TMistan — Afghanistan Trademark Registry

Public search platform for trademark records published in the Afghanistan Official Gazette.
**Supabase is the single source of truth**: the web app never ships mock data, never keeps a
parallel copy of the dataset and never filters the whole registry in the browser — every list,
search, filter and statistic is a database query.

```
┌────────────────────────────┐   HTTPS (publishable key + RLS)   ┌──────────────────────────────┐
│  Browser                   │ ────────────────────────────────▶ │  Supabase project            │
│  React SPA (web/)          │   PostgREST  /rest/v1/rpc/*       │  Postgres  public.trademarks │
│  served by nginx           │   Storage    /storage/v1/object   │            gazettes, images… │
│  (Docker → Railway/Render) │ ◀──────────────────────────────── │  Storage   trademark-images  │
└────────────────────────────┘                                   └──────────────▲───────────────┘
                                                                                 │ service-role key
                                                    ┌────────────────────────────┴───────────────┐
                                                    │  Operator tools (never deployed, never in   │
                                                    │  the browser): importers/*.py, migrations   │
                                                    └─────────────────────────────────────────────┘
```

There is **no application server**. The container is a static nginx serving the built SPA;
authorisation is decided by Row Level Security in Postgres, so the only key in the browser is the
public (publishable / anon) key. The service-role key exists only on the machine that runs importers.

## Repository layout

| Path | What | Ships in the Docker image? |
|---|---|---|
| `web/` | React 19 + TypeScript + Vite + Tailwind SPA (the product) | **yes** (built to static files) |
| `web/src/services/` | the centralised data-access layer — the *only* place that talks to Supabase | yes |
| `deploy/nginx.conf.template` | nginx site config (SPA fallback, `/healthz`, `$PORT`) | yes |
| `Dockerfile`, `.dockerignore`, `railway.toml`, `render.yaml` | deployment | — |
| `supabase/migrations/` | schema, search functions, RLS + storage policies (apply with SQL editor / CLI) | no |
| `importers/` | Python bulk-import tools (Excel records, gazette images) — use the service-role key | no |
| `scripts/local-stack/` | offline dev stack: PostgreSQL + PostgREST + static image server, no Supabase account needed | no |
| `scripts/check_supabase.py` | readiness check of a Supabase project using only the public key | no |
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
| `import_jobs`, `audit_logs`, `user_roles`, `is_admin()` | admin-only under RLS (0100/0300) | admin dashboard |
| Storage bucket `trademark-images` (public read, admin write) | (0300) | image URLs |

Until migrations 0100 → 0200 → 0300 are applied, only `trademarks` exists and the UI shows a
"Database not ready" error state (it never falls back to fake data).

## Environment variables

Real values live only in git-ignored files (`web/.env.local`, `importers/.env`) or in the hosting
platform's variables. `.env.example` files contain placeholders only.

| Variable | Where | Purpose |
|---|---|---|
| `SUPABASE_URL` | web build (Docker build-arg / Railway / Render variable) | `https://<ref>.supabase.co` — public |
| `SUPABASE_PUBLISHABLE_KEY` | web build | publishable (`sb_publishable_…`) or legacy anon JWT — public by design; the build **refuses** a `sb_secret_`/service-role key |
| `SITE_CONTACT_EMAIL` `SITE_CONTACT_PHONE` `SITE_CONTACT_ADDRESS` `SITE_FACEBOOK_URL` `SITE_TWITTER_URL` `SITE_LINKEDIN_URL` | web build, optional | footer contact / social links (hidden when unset) |
| `PORT` | container runtime | nginx listen port (Railway/Render inject it; default 8080) |
| `ENVIRONMENT` | container runtime, informational | `production` / `staging` |
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
python3 scripts/local-stack/seed_dev_fixtures.py --no-images   # optional synthetic rows (refuses to run if real rows exist)
# web/.env.local:  SUPABASE_URL=/supabase  SUPABASE_PUBLISHABLE_KEY=<LOCAL_ANON_KEY from keys.env>  VITE_LOCAL_STORAGE_BASE=/local-storage
cd web && npm run dev
```

Quality gates: `cd web && npx tsc -b && npm run lint && npm run build`.

## Supabase configuration (one-time, done by a project owner)

1. **Backup** (Dashboard → Database → Backups).
2. **Apply migrations** in the SQL editor, in this order — each file is idempotent and only *adds*
   objects; the existing `trademarks` rows and the `(official_gazette_number, serial_number)` uniqueness are preserved:
   1. `supabase/migrations/20260905000100_registry_schema.sql`
   2. `supabase/migrations/20260905000200_search.sql`
   3. `supabase/migrations/20260905000300_rls_and_storage.sql` (also creates the `trademark-images` bucket + policies)

   Do **not** run `…0000_baseline…` or `supabase/dev/00_supabase_shim.sql` — those emulate Supabase for the offline stack.
3. **Verify**: `python3 scripts/check_supabase.py` (above) must print "All checks passed".
4. **Admin users** (Phase 2): create the user in Authentication, then
   `insert into public.user_roles (user_id, role) values ('<auth uid>', 'admin');`
5. **Auth → URL configuration**: add the deployed origin (needed for admin login).

## Importers (operator machine, service-role key)

```bash
cd importers && cp .env.example .env         # SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + SUPABASE_BUCKET
pip install -r requirements.txt
python3 image_importer.py --root /path/to/images --gazette 1011 --dry-run --verbose   # report only
python3 image_importer.py --root /path/to/images                                      # idempotent; re-run = "skipped"
```

Images are matched **only** by `<gazette>/<gazette>-<serial>.<ext>`; unmatched/ambiguous files go
to `trademark_images.status ∈ {unmatched, ambiguous}` for review and are never shown publicly.
Every run is recorded in `import_jobs` / `import_job_items`. See `docs/DEPLOYMENT.md §5`.

## Docker (production image)

```bash
# build — the two public values are baked into the JS bundle; nothing else enters the image
docker build \
  --build-arg SUPABASE_URL=https://<ref>.supabase.co \
  --build-arg SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
  -t tmistan .

docker run --rm -p 8080:8080 -e PORT=8080 tmistan
curl http://localhost:8080/healthz      # → ok
```

Image: `node:20-alpine` build stage → `nginxinc/nginx-unprivileged:1.27-alpine` runtime (~50 MB,
non-root, no dev server, no `.env` files, SPA fallback, hashed assets cached for a year,
`/healthz`, honours `$PORT`). The build fails if the public key is missing or if a secret key is
passed by mistake.

## Deploying

### Railway (recommended — single service, zero config)

1. Railway → **New Project → Deploy from GitHub repo** → select this repo (root directory `/`).
   `railway.toml` makes Railway use the `Dockerfile` and `/healthz`.
2. Service → **Variables** → add `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (Railway passes service
   variables to the Docker build as build-args; optional `SITE_*` too). `PORT` is injected automatically.
3. **Deploy** (first deploy starts automatically after step 2 — or click *Redeploy* if it built before the variables existed).
4. Settings → **Networking → Generate domain** (or attach your own). Open it → home page shows real counts.
5. Add that domain to Supabase → Authentication → URL configuration (for admin login).

CLI alternative: `railway login && railway init && railway variables set SUPABASE_URL=… SUPABASE_PUBLISHABLE_KEY=… && railway up`.

### Render (alternative)

1. Render → **New → Blueprint** → connect the repo; `render.yaml` defines a Docker web service with `/healthz`.
2. In the created service → **Environment** → set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` → *Manual Deploy → Deploy latest commit*.
3. Use the `onrender.com` URL or add a custom domain; add it to Supabase Auth URL configuration.

## Security model (reviewed)

- Browser holds only the publishable key; RLS policies (`0300`) allow anonymous **read** of
  `trademarks`/`gazettes`/`trademark_images`, nothing else; all writes and `import_jobs`/`audit_logs`
  are admin-only via `is_admin()`. Verified: anon `INSERT` → 401/403, `import_jobs` → permission denied.
- `vite.config.ts` and the `Dockerfile` reject `sb_secret_*` / service-role JWTs as the public key;
  the bundle is grepped for secrets during validation.
- `.gitignore` excludes every `.env*` except `*.example`; `.dockerignore` limits the build context to `web/` + `deploy/`
  (importers, migrations, local keys never enter the image).
- nginx sends `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`; runs unprivileged.
- No `dangerouslySetInnerHTML`, no `eval`; user input reaches Postgres only as RPC parameters (parameterised by PostgREST).

## Non-negotiables encoded in the code

- No mock data, no second database, no client-side filtering of the dataset — `search_trademarks` does the work server-side.
- Every screen has explicit **loading / empty / error** states; a missing schema is reported as "Database not ready", never hidden.
- Detail page renders only fields that exist and are non-null; images come from `trademark_images` or a neutral placeholder — never a fabricated logo.
- Images: bytes in Storage, metadata in `trademark_images`, matched only by gazette + serial.
- Every trademark shows gazette / page / file / sheet / row provenance.
- Schema changes only via explicit migrations; existing records and the gazette+serial uniqueness are preserved.
