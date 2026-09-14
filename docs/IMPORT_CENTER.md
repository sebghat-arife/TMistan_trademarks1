# Admin → Import Center

The Import Center is the production path for getting the registry into Supabase: **Excel/CSV →
validate → import trademarks → upload images → match by serial number → Storage +
`trademark_images` → public search**. It runs entirely in the browser of a signed-in administrator
on the Render static site — no Python, no local paths, no server of ours — and every privileged
step goes through `SECURITY DEFINER` functions that verify `public.is_admin()` before touching a row.

```
┌ Admin browser (publishable key + admin JWT) ─────────────────────────────────────┐
│ 1. parse .xlsx/.xls/.csv (SheetJS, lazy)      2. read images / unzip (fflate)     │
│    → header detection, validation             → magic-byte sniffing, sha256       │
│ ───────────────── rpc admin_import_trademark_rows ─────── rpc admin_resolve_serials│
│ ───────────────── storage upload (RLS: admin only) ────── rpc admin_register_images│
└──────────────────────────────────────────────────────────────────────────────────┘
        ▼ Postgres: trademarks · import_jobs · import_job_items · trademark_images
        ▼ Storage bucket trademark-images/<gazette>/<serial>.<ext>  (public read)
        ▼ Public search & detail pages (search_trademarks → primary image path)
```

## 1. One-time setup

| Step | Where | What |
|---|---|---|
| a | Supabase → SQL Editor | Run **`supabase/APPLY_0400.sql`** (only 0400) — or `supabase/APPLY_ALL.sql` on a fresh project. Both are idempotent. Read the *Messages* tab (see §6). |
| b | Supabase → Authentication → Users | *Add user* → e-mail + password, **Auto confirm** ticked. |
| c | Supabase → SQL Editor | `insert into public.user_roles (user_id, role) select id, 'admin' from auth.users where email = '<e-mail>' on conflict do nothing;` |
| d | Supabase → Authentication → URL configuration | Add the Render origin (e.g. `https://tmistan.onrender.com`) to *Site URL / Redirect URLs*. |
| e | Operator machine | `python3 scripts/check_supabase.py` → section **2b** must list all `admin_*` functions as present. |

Bucket `trademark-images` (public read, 10 MB, image MIME types) already exists
(`python3 scripts/setup_storage.py` creates it on a new project).

### What 0400 adds (nothing is dropped or rewritten)

| Object | Purpose |
|---|---|
| `serial_canonical(text)` | `'1011-002'`, `' 1011_2 '`, `'۱۰۱۱-۰۰۲'`, `'IMG_1011-002'` → `'1011-2'`; non-serials → `null` |
| unique index `trademarks_serial_number_key (serial_number)` | the stable identifier used for idempotent imports — **created only if no duplicates exist** (otherwise a WARNING lists them and gazette+serial uniqueness remains the guard) |
| index `trademarks_serial_canonical_idx` | fast tolerant matching of image file names |
| `admin_assert()` | raises `42501 Administrator role required` unless `is_admin()` |
| `admin_create_import_job / admin_finish_import_job / admin_add_import_items` | job bookkeeping (`import_jobs`, `import_job_items`) |
| `admin_import_trademark_rows(job, rows≤1000)` | whitelist-column upsert keyed on `serial_number`; per-row sub-transaction; returns `{inserted, updated, skipped, failed, results[]}` |
| `admin_resolve_serials(text[]≤2000)` | file-name serial → trademark, tiers `serial_exact · serial_normalized · serial_numeric · unmatched · ambiguous` |
| `admin_register_images(job, items≤500)` | upserts `trademark_images` on `(storage_bucket, storage_path)`, status `matched`, `image_type logo` |
| `admin_trademarks_without_images(limit, offset)` | "trademarks still without an image" report |
| Storage policies `tmistan admin select/insert/update/delete trademark images` | `authenticated` role **and** `is_admin()` may write to that bucket only; anon stays read-only |

All functions are `SECURITY DEFINER`, `EXECUTE` is granted to `authenticated` only (revoked from
`public`/`anon`), and each one calls `admin_assert()` first — a signed-in non-admin gets `42501`,
an anonymous caller `401`.

## 2. Using the Import Center

Sign in at `/admin/login`, open **Import Center** in the sidebar.

### Step 1 — Trademark data (`.xlsx`, `.xls`, `.csv`)

1. Drop the file (or *Choose file*). The page shows *File · Records detected · Columns detected ·
   Sheet* and a preview of the first rows.
2. Headers are detected automatically (English / Dari / Pashto and `snake_case` variants; the
   header row may be preceded by title rows). Only **Serial Number** is mandatory; the gazette
   number is taken from the *Official Gazette Number* column or derived from the serial prefix
   (`1011-002` → gazette `1011`). Recommended columns: Mark Name, Applicant Name, Trademark Class,
   Goods and Services, Application Type, Publication Date.
3. Validation runs **before** anything is written:
   * empty / missing serial → *error* (row skipped)
   * the same serial twice in the file → *error* on the later row (first occurrence wins)
   * unparsable date (`31/13/1389`, `1389-12-30` in a non-leap year) → *error*
   * non-numeric record/page/row number → *warning* (kept as text)
   * required column missing / no header row / no rows → import blocked with an explanation
   *Download issues CSV* lists every problem with its sheet row number.
4. **Import N trademarks** — batches of 500 rows, live progress bar and Processed / Inserted /
   Updated / Unchanged / Failed counters. Dates are stored exactly as printed (Solar Hijri,
   `1389-11-30`); classes stay text (`"9, 11"`, the generated `class_numbers` array follows).
5. Result banner + *Recent Imports* row. Failed rows (if any) are listed in *View report*.

**Idempotent by design.** The key is `trademarks.serial_number`. Re-importing the same file
reports every row as *Unchanged*; re-importing a corrected file updates only the rows whose
mapped columns differ (absent columns keep their current value; an empty cell in a mapped column
clears the value). `source_file`/`source_sheet`/`source_row` are provenance columns and count as
changes, so the *same* data from a differently named file shows as *Updated* — the trademark rows
are not duplicated in any case.

### Step 2 — Trademark images (`.jpg .jpeg .png .webp .gif .tif` or a `.zip` of them)

Name every file with the trademark's serial number: **`1011-002.png`**. The file name without its
extension is the only matching key; folder names inside a ZIP are ignored (`gazette 1045/1045-001.png`
is fine), as are `__MACOSX`, `.DS_Store`, `Thumbs.db`.

1. Drop the files/ZIP. The browser sniffs the real content type (extension alone is not trusted),
   rejects files > 10 MB, hashes content and derives the serial:
   `' 1011-5 .png'` → `1011-5` → matches `1011-005` (numeric tier); `1011_004.webp` → `1011-004`
   (normalized tier); `۱۰۱۱-۰۰۲.png` (Persian digits) → `1011-002`. `IMG_1011-002.png` also works.
   Matching never guesses: if two trademarks would match at the best tier the file is
   *ambiguous* and is **not** uploaded.
2. **Match preview**: Images processed · Matched · No trademark found · Ambiguous · Duplicates ·
   Invalid files, with a table of every problem and *Download unmatched CSV*
   (file, serial, level, message). Only *Matched* files are uploaded — one image per trademark
   per batch (the first file wins; the second `1011-006.jpg` next to `1011-006.png` is reported as a
   duplicate).
3. **Upload N images** — each file goes to `trademark-images/<gazette>/<serial>.<ext>` (upsert), then
   `trademark_images` is upserted with `trademark_id`, `storage_path`, `content_hash`, dimensions,
   `status = matched`, `sort_order 0` (= primary image). Progress shows Uploaded / Linked /
   Unchanged / Failed. Re-uploading the same file is *already up to date* (same `sha256`); a new
   file for the same serial **replaces** the old image (same storage path, hash changes).
4. *Show trademarks without an image* lists (and exports) what is still missing.

The public site reads `trademark_primary_images` / `search_trademarks`, so the real image appears
on `/trademark/<serial>` and in the search cards as soon as the upload finishes (CDN cache 1 h for
replacements).

### Recent Imports

`Date · Type (Data / Images) · File name · Records (inserted+updated+unchanged / total) · Images
(linked / total) · Status` for the last 25 jobs, with *View report* (summary JSON, per-item failures /
unmatched / duplicates, retry hint). Statuses: `processing` (page was closed mid-way — just drop the
file again), `completed`, `completed_with_warnings` (some rows/files rejected, see report), `failed`.

### Retry / recovery

Everything is re-runnable: drop the same spreadsheet or images again. Rows and files that are
already in place are recognised (*Unchanged* / *already up to date*), so a retry only performs the
missing work.

## 3. Security model

* The browser holds only the **publishable** key; the admin's JWT comes from Supabase Auth
  (`/admin/login`). The service-role key is never in the app, the build, `render.yaml` or the bundle
  (the build greps for `sb_secret_` / `service_role`).
* Anonymous users: `SELECT` on published trademarks/gazettes/matched images only; every write path
  (`trademarks`, `trademark_images`, `import_jobs`, Storage bucket) is refused
  (`scripts/check_supabase.py` §4/§5 verifies this against the live project).
* Signed-in non-admins: same as anonymous plus `SELECT` on `import_jobs`; every `admin_*` RPC and
  every Storage write raises `42501`.
* Admins: writes only through the RPCs (whitelisted columns, size-capped batches, per-row error
  isolation) and the bucket policies. There is no `DELETE` on `trademarks` from the browser.
* Route guard: `/admin/*` renders only after `is_admin()` returns true for the session.

## 4. Environment variables

| Variable | Where | Value |
|---|---|---|
| `SUPABASE_URL` | Render Static Site env (build time) | `https://<project-ref>.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | Render Static Site env (build time) | `sb_publishable_…` (never `sb_secret_…` — the build refuses it) |
| `NODE_VERSION` | Render | `22.12.0` (in `render.yaml`) |
| `SUPABASE_SERVICE_ROLE_KEY` | **operator machine only** (`importers/.env`, git-ignored) | for `scripts/setup_storage.py` and the optional Python importers; not needed by the Import Center |

Nothing else — the Import Center uses no extra variables, no serverless function and no third-party service.

## 5. Verifying an import (operator machine)

```bash
python3 scripts/check_supabase.py            # publishable key: schema, 0400 functions, RLS, storage
```

Service-role spot checks (Supabase SQL editor, or `psql` with the DB password):

```sql
select status, count(*) from import_jobs group by 1;
select job_type, filename, total_rows, inserted_rows, updated_rows, skipped_rows, failed_rows, status
  from import_jobs order by created_at desc limit 10;
select t.serial_number, t.mark_name, i.storage_path, i.status, i.content_hash
  from trademark_images i join trademarks t on t.id = i.trademark_id order by i.created_at desc limit 10;
select count(*) from trademarks t where not exists (select 1 from trademark_images i where i.trademark_id = t.id and i.status = 'matched');
```

Public check: open `/trademark/<serial>` and `/search?q=<mark>` — the card/detail image URL is
`…/storage/v1/object/public/trademark-images/<gazette>/<serial>.<ext>`.

## 6. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Red banner *Import Center is not available yet* | 0400 not applied → run `supabase/APPLY_0400.sql`; then reload. |
| `Administrator role required` (42501) | Signed-in user has no `user_roles` row with `role = 'admin'` (§1c). |
| Upload error mentioning *storage policies* | The four `tmistan admin … trademark images` policies are missing. Re-run `APPLY_0400.sql` **in the Dashboard SQL editor** (external `psql` sessions may lack the rights) or create them in Storage → Policies: target `authenticated`, `INSERT/UPDATE/DELETE`, `bucket_id = 'trademark-images' and public.is_admin()`. |
| WARNING `trademarks_serial_number_key NOT created` | duplicated `serial_number` values exist; the message lists them. Fix the rows and re-run 0400. Imports work meanwhile (gazette+serial uniqueness), matching by serial still resolves to the oldest row. |
| A file is *No trademark found* | The serial is not in `trademarks` — import the spreadsheet first, or fix the file name. |
| *Ambiguous* | Two trademarks share the serial at the best matching tier; correct the data, not the file name. |
| Import finished but the public page shows the old image | CDN cache (1 h). Hard-reload, or wait. |
| `.xls` (binary 97-2003) fails to parse | Save as `.xlsx` from Excel. |

## 7. Files

`web/src/pages/admin/ImportCenterPage.tsx` (UI) · `web/src/services/import_service.ts` (RPC/Storage calls) ·
`web/src/lib/import/{spreadsheet,images,serial}.ts` (browser parsing, validation, matching keys) ·
`supabase/migrations/20260905000400_admin_import.sql` · `supabase/APPLY_0400.sql` ·
`scripts/check_supabase.py` (§2b) · i18n keys `admin.import.*` in `web/src/i18n/locales/{en,fa,ps}.json`.
