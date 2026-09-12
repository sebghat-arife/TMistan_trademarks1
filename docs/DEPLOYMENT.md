# Deployment runbook — from the local stack to the real Supabase project

## 0. Before touching production

1. Export the live schema so we can diff it against the assumptions in `0000_baseline`:
   ```sql
   select column_name, data_type, is_nullable
     from information_schema.columns
    where table_schema = 'public' and table_name = 'trademarks'
    order by ordinal_position;

   select indexname, indexdef from pg_indexes where tablename = 'trademarks';
   ```
   If a column in `0000_baseline` has a different name/type in production, **edit the
   baseline file only** — the later migrations use `ADD COLUMN IF NOT EXISTS` and
   reference columns by name, so a mismatch will surface as a clear error, never as data loss.

2. Take a backup: Dashboard → Database → Backups, or `pg_dump --schema=public`.

3. Confirm the unique index exists (whatever its name):
   ```sql
   select indexdef from pg_indexes
    where tablename = 'trademarks' and indexdef ilike '%official_gazette_number%serial_number%';
   ```
   If it exists under another name, that is fine — `0100` will add a second one only if
   `trademarks_gazette_serial_key` is missing; drop the duplicate afterwards if you prefer.

## 1. Apply migrations

SQL Editor → New query → paste **`supabase/APPLY_ALL.sql`** (0100 + 0200 + 0300 concatenated, wrapped
in one transaction) → Run. Idempotent; re-run any time after editing a migration and regenerating the
file with `python3 scripts/build_apply_all.py`.

Applied to project `tzzslhpqbfjklazihssc` on 2026-09-12 — post-checks: trademarks 732, gazettes 12,
policies 11, anon can read 732.

Supabase CLI alternative: `supabase link --project-ref <ref>` then `supabase db push` after moving
`…0000_baseline…` out of `supabase/migrations/` (it is local-only).

Post-checks:
```sql
select count(*) from trademarks;                          -- unchanged (732)
select gazette_number, trademark_count from gazette_summaries order by sort_key;  -- 12 rows
select registry_stats();
select * from search_trademarks(p_query => 'caravell', p_limit => 5);
```

## 2. Storage

Buckets are created with the Storage API (the SQL editor role cannot manage `storage.objects`
policies on hosted Supabase any more): `python3 scripts/setup_storage.py` with `importers/.env`
filled in. Result on the production project:

- `trademark-images` — public read, 10 MB limit, image MIME types only, writes only via service role
- `source-documents` — private, 50 MB limit

## 3. Admin users

Auth → Users → invite the administrators. Then:
```sql
insert into public.user_roles (user_id, role) values ('<auth.users.id>', 'admin');
```
`public.is_admin()` drives every admin RLS policy **and** gates the `/admin` routes in the web app
(the dashboard calls the RPC after sign-in; anyone without a `user_roles` row is sent back to the login page).

## 4. Web app — Render Static Site

`render.yaml` (Blueprint) = Static Site, root `web`, build `npm ci && npm run build`, publish `dist`,
rewrite `/* → /index.html`, Node 22.12.0. Environment: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`.
Exact click-by-click steps are in the README ("Deploying to Render").

Before the first deploy: `python3 scripts/check_supabase.py --expect-rows 732`.

Add the deployed origin to Supabase → Authentication → URL configuration (needed later
for admin login; harmless now).

## 5. Image import (one gazette first)

On a trusted machine (never in the browser, never in CI logs):

```bash
cd importers
cat > .env <<EOF
SUPABASE_URL=https://<PROJECT_REF>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key>
SUPABASE_BUCKET=trademark-images
EOF

python image_importer.py --root /path/to/images --gazette 1011 --dry-run --verbose
```

Read the report. Expected shape:

```
Gazette 1011
  Images found:      71
  Matched (new):     69
  Missing trademark: 1
  Ambiguous:         1
DRY RUN — NO FILES UPLOADED, NO ROWS WRITTEN
```

If the folder convention differs from `<gazette>/<gazette>-<serial>.<ext>`, do **not** add
heuristics — tell me the real pattern and we add it as an explicit rule in `parse_candidate()`.
Then:

```bash
python image_importer.py --root /path/to/images --gazette 1011
python image_importer.py --root /path/to/images            # all gazettes
python image_importer.py --root /path/to/images            # again: everything "skipped" = idempotent
```

`import_jobs` records every run; `trademark_images where status <> 'matched'` is the review queue.

## 6. Existing Excel importer — one optional line

The existing Python importer keeps working unchanged (the gazette FK is on the natural key and
the `gazettes` row is auto-created by trigger). Optionally, to get import history, have it
insert one `import_jobs` row per file and set `trademarks.import_job_id`.

## 7. Roll-back

All objects added by 0100–0300 can be removed without touching the original columns:

```sql
drop function if exists search_trademarks, similar_trademarks, trademark_filter_options, registry_stats cascade;
drop view if exists gazette_summaries, trademark_primary_images;
drop table if exists import_job_items, import_jobs, trademark_images, audit_logs, user_roles;
alter table trademarks drop constraint if exists trademarks_official_gazette_number_fkey;
drop table if exists gazettes;
-- generated/added columns:
alter table trademarks
  drop column if exists search_vector, drop column if exists class_numbers,
  drop column if exists mark_name_normalized, drop column if exists applicant_name_normalized,
  drop column if exists goods_and_services_normalized, drop column if exists attorney_normalized,
  drop column if exists serial_number_normalized, drop column if exists is_published,
  drop column if exists review_status, drop column if exists reviewed_by, drop column if exists reviewed_at,
  drop column if exists review_comment, drop column if exists import_job_id;
```
