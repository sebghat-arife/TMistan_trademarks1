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

Using the Supabase CLI (recommended, gives you history in `supabase_migrations.schema_migrations`):

```bash
supabase login
supabase link --project-ref <PROJECT_REF>
# The baseline is for local only — move it out of the way:
mv supabase/migrations/20260905000000_baseline_existing_trademarks.sql supabase/dev/
supabase db push            # applies 0100, 0200, 0300 in order
```

Or paste each file into the SQL editor in order (0100 → 0200 → 0300).

Post-checks:
```sql
select count(*) from trademarks;                          -- unchanged (≈732)
select gazette_number, trademark_count from gazette_summaries order by sort_key;  -- 12 rows
select registry_stats();
select * from search_trademarks(p_query => 'caravell', p_limit => 5);
```

## 2. Storage

`0300` creates the buckets when run on Supabase. Verify in Dashboard → Storage:

- `trademark-images` — public, 10 MB limit, image MIME types only
- `source-documents` — private

## 3. Admin users

Auth → Users → invite the administrators. Then:
```sql
insert into public.user_roles (user_id, role) values ('<auth.users.id>', 'admin');
```
`public.is_admin()` drives every admin RLS policy **and** gates the `/admin` routes in the web app
(the dashboard calls the RPC after sign-in; anyone without a `user_roles` row is sent back to the login page).

## 4. Web app

```bash
cd web
cat > .env.local <<EOF
VITE_SUPABASE_URL=https://<PROJECT_REF>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
EOF
npm run build     # output in web/dist
```

### Vercel
Import the repo, set **Root Directory** = `web`, framework = Vite, add the two `VITE_*`
env vars. `web/vercel.json` already rewrites all routes to `index.html`.

### Cloudflare Pages
Build command `npm run build`, output `dist`, root `web`. `web/public/_redirects`
handles SPA routing. Add the two `VITE_*` env vars.

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
