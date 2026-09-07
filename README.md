# TMistan — Afghanistan Trademark Registry

<img src="web/public/brand/logo.png" alt="TMistan" width="180">

Supabase is the single source of truth. The web app is a thin, typed client over it;
Python handles bulk ingestion. Nothing is mocked, generated, or filtered client-side.

```
OFFICIAL GAZETTES ─► Excel + image folders
                          │
            ┌─────────────┴─────────────┐
            ▼                           ▼
   Python Excel importer        importers/image_importer.py
   (existing, unchanged)        (deterministic gazette+serial match, dry-run, idempotent)
            └─────────────┬─────────────┘
                          ▼
                 ┌──────────────────┐
                 │     SUPABASE     │  PostgreSQL · Storage · Auth · RLS
                 │  supabase/migrations/*.sql
                 └────────┬─────────┘
                          ▼
                 ┌──────────────────┐
                 │   web/  (Vite)   │  React · TS · Tailwind · TanStack Query · React Router · i18n
                 │  /search /trademarks /trademark/:serial /gazettes /gazette/:n /about /help /admin
                 └──────────────────┘
```

## Repository layout

| Path | What it is |
|---|---|
| `supabase/migrations/` | Reviewable SQL migrations. Additive only; never rewrite existing rows. |
| `supabase/dev/00_supabase_shim.sql` | **Local dev only** — emulates Supabase roles + `auth.uid()` on plain PostgreSQL. |
| `web/` | The application — public search, detail, gazettes, about/help (EN / Dari / Pashto) + the Phase-2 admin shell (dashboard behind `is_admin()`). UI follows the approved TMistan mock-up. |
| `importers/image_importer.py` | Image ingestion pipeline (§33–35 of the strategy). |
| `scripts/local-stack/` | PostgreSQL 17 + PostgREST + static-storage stack that mimics Supabase locally. |
| `docs/` | Deployment runbook, Lovable hand-off prompt, schema notes. |

## Migrations (apply in order)

| File | Purpose |
|---|---|
| `20260905000000_baseline_existing_trademarks.sql` | **Do not run on production.** Mirror of the table that already exists, so a fresh local DB starts from the same point. |
| `20260905000100_registry_schema.sql` | `gazettes`, `trademark_images`, `import_jobs`, `import_job_items`, `audit_logs`, `user_roles`; review/provenance columns; Arabic-script-aware `normalize_text()`; generated normalized columns + GIN/trigram indexes; audit trigger; auto-create gazette trigger. |
| `20260905000200_search.sql` | `search_trademarks()` (all filters combine, prefix FTS + trigram fuzzy, ranked, paginated), `similar_trademarks()`, `recent_trademarks()`, `trademarks_by_class()`, `trademark_filter_options()`, `registry_stats()` (incl. unique applicants), `gazette_summaries` view, `trademark_primary_images` view. |
| `20260905000300_rls_and_storage.sql` | RLS on every table (public reads published rows; admins via `user_roles`; no DELETE through the API), grants, `trademark-images` (public) and `source-documents` (private) buckets + policies. |

Every statement is `IF NOT EXISTS` / `CREATE OR REPLACE` — re-running is safe.
The unique rule `(official_gazette_number, serial_number)` is preserved and enforced.

## Running locally (no Supabase account needed)

```bash
# 0. Requirements: PostgreSQL 17 (apt install postgresql), PostgREST binary in ~/.local/bin, Node 20, Python 3.11+
pip install httpx pillow "psycopg[binary]"

# 1. Database + migrations
scripts/local-stack/start.sh

# 2. API + storage (two terminals / background)
~/.local/bin/postgrest scripts/local-stack/postgrest.conf         # :54321
python3 scripts/local-stack/static_storage.py local-storage 54322 # :54322

# 3. Optional fixtures (refuses to run if real rows exist)
python3 scripts/local-stack/seed_dev_fixtures.py
python3 importers/image_importer.py --root local-storage/incoming --dry-run
python3 importers/image_importer.py --root local-storage/incoming --local-storage-dir local-storage

# 4. Web
cd web && cp .env.example .env.local   # local block is pre-filled by start.sh keys
npm install && npm run dev             # http://localhost:5173
```

## Connecting to the real Supabase project

See `docs/DEPLOYMENT.md`. Short version:

1. `supabase link --project-ref <ref>` then `supabase db push` (skip the `0000_baseline` file).
2. Verify: `select count(*) from trademarks;` still returns your 732 rows and `select * from gazette_summaries;` lists 12 gazettes.
3. `web/.env.local` → `VITE_SUPABASE_URL=https://<ref>.supabase.co`, `VITE_SUPABASE_ANON_KEY=<anon>`.
4. `importers/.env` → service-role key **on the import machine only**.
5. `python importers/image_importer.py --root <images> --gazette 1011 --dry-run` → inspect → real run.

## Non-negotiables encoded in the code

- No mock data, no second database, no client-side filtering of the dataset (`search_trademarks` RPC does the work).
- Images: bytes in Storage, metadata in `trademark_images`; matched **only** by gazette + serial; unmatched/ambiguous go to a review queue, never attached.
- Imports never fail silently: `import_jobs` + `import_job_items`, `completed_with_warnings` status.
- Every trademark shows gazette / page / file / sheet / row provenance.
- Service-role key never reaches the browser (RLS + anon key only; the build is grepped for it).
- AI (future) is supplemental — Supabase remains authoritative; schema leaves room for embeddings without changes to existing tables.
