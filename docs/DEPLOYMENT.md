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

SQL Editor → New query → paste **`supabase/APPLY_ALL.sql`** (0100 + 0200 + 0300 + 0400 concatenated,
wrapped in one transaction) → Run. Idempotent; re-run any time after editing a migration and
regenerating the file with `python3 scripts/build_apply_all.py` (which also emits `APPLY_0400.sql`).

Project `tzzslhpqbfjklazihssc`: 0100–0300 applied 2026-09-12 (post-checks: gazettes 12, policies 11,
anon can read every published row). **0400 (Import Center) is pending** — paste
`supabase/APPLY_0400.sql`; it only adds functions, two indexes and four Storage policies.

Supabase CLI alternative: `supabase link --project-ref <ref>` then `supabase db push` after moving
`…0000_baseline…` out of `supabase/migrations/` (it is local-only).

Post-checks:
```sql
select count(*) from trademarks;                          -- unchanged by any migration
select gazette_number, trademark_count from gazette_summaries order by sort_key;  -- 12 rows
select registry_stats();
select * from search_trademarks(p_query => 'caravell', p_limit => 5);
```

## 2. Storage

Buckets are created with the Storage API (the SQL editor role cannot manage `storage.objects`
policies on hosted Supabase any more): `python3 scripts/setup_storage.py` with `importers/.env`
filled in. Result on the production project:

- `trademark-images` — public read, 10 MB limit, image MIME types only; writes by the service role
  and — after 0400 — by signed-in administrators (`is_admin()`) from the Import Center
- `source-documents` — private, 50 MB limit

## 3. Admin users

Auth → Users → *Add user* (e-mail + password, auto-confirm). Then:
```sql
insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where email = '<e-mail>' on conflict do nothing;
```
`public.is_admin()` drives every admin RLS policy **and** gates the `/admin` routes in the web app
(the dashboard calls the RPC after sign-in; anyone without a `user_roles` row is sent back to the login page).

## 4. Web app — Render Static Site

`render.yaml` (Blueprint) = Static Site, root `web`, build `npm ci && npm run build`, publish `dist`,
rewrite `/* → /index.html`, Node 22.12.0. Environment: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`.
Exact click-by-click steps are in the README ("Deploying to Render").

Before the first deploy: `python3 scripts/check_supabase.py` (add `--expect-rows N` once you know
how many records your files contain).

Add the deployed origin to Supabase → Authentication → URL configuration (needed for admin login).

## 4b. Loading the registry — Admin → Import Center

This is the normal path (`docs/IMPORT_CENTER.md`): sign in at `/admin/login`, drop the Excel/CSV,
review validation, import, then drop the images / ZIP named `<serial>.<ext>`. Every run is an
`import_jobs` row; re-running is idempotent. The public site shows the real images immediately.

## 5. Optional: bulk image import from a folder (Python)

Only when a whole gazette folder is easier to load from a machine than through the browser.
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

## 6. Spreadsheet imports

Spreadsheets are imported through the Import Center (`admin_import_trademark_rows`, keyed on
`serial_number`, whitelisted columns, provenance in `source_file/source_sheet/source_row`,
`import_job_id`). A legacy Python Excel importer keeps working unchanged if you still have one —
the gazette FK is on the natural key and the `gazettes` row is auto-created by trigger.

## 7. Roll-back

0400 first (functions, indexes, storage policies — no data):

```sql
drop function if exists admin_import_trademark_rows, admin_resolve_serials, admin_register_images,
  admin_trademarks_without_images, admin_add_import_items, admin_finish_import_job,
  admin_create_import_job, admin_assert, serial_canonical cascade;
drop index if exists trademarks_serial_number_key, trademarks_serial_canonical_idx;
drop policy if exists "tmistan admin insert trademark images" on storage.objects;
drop policy if exists "tmistan admin update trademark images" on storage.objects;
drop policy if exists "tmistan admin delete trademark images" on storage.objects;
drop policy if exists "tmistan admin select trademark images" on storage.objects;
```

Then, if needed, everything added by 0100–0300 can be removed without touching the original columns:

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
