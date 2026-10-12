# Admin Data Management Center

`/admin` (reached only by typing `/admin/login`; there is no Login button on the public site).
Everything below is implemented in the web app + migration **0600**
(`supabase/migrations/20261012000600_data_management.sql`, paste as `supabase/APPLY_0600.sql`).

Until 0600 is applied to a project, every data-management page shows
*"Migration 0600 has not been applied"* and offers nothing destructive; the Import Center keeps working.

## 1. Navigation

| Route | Page | What it does |
|---|---|---|
| `/admin` | **Data Overview** | live counts (trademarks published/archived/without images/with provenance, images matched/unlinked/indexed/bytes, imports running/stale/failed, cleanup queue, audit) + stale-import warning + by-class chart + recent imports |
| `/admin/trademarks` | **Trademark Records** | search any field (serial, mark, applicant, registration/application no.), filters (status, images, gazette), sort, multi-select, archive / restore / permanent delete, record detail with *all* stored fields incl. administrator-only ones, linked images, provenance (created-by / last import), change history |
| `/admin/images` | **Trademark Images** | every `trademark_images` row with preview, Storage path, size, status, linked record, provenance; select + delete; `?job=` filter |
| `/admin/images/unmatched` | **Unmatched Images** | image rows not linked to a record + files that image imports reported as unmatched/ambiguous (CSV) |
| `/admin/imports/excel` | **Excel/CSV Imports** | the Import Center spreadsheet flow (21-column mapping, validation, preview, counts) |
| `/admin/imports/images` | **ZIP Image Imports** | the Import Center image flow (ZIP/files, serial matching, upload, visual-index) |
| `/admin/history` | **Import History** | all jobs (type, file name, time, status, total/inserted/updated/unchanged/failed, *created* recounted live, job id, started by), item report CSV, records of the batch (created / updated / images, "modified later" flag), cancel running job, delete import record, delete records created by the batch, retention cleanup |
| `/admin/storage` | **Orphaned Files** | Storage cleanup queue (retry), scan of bucket `trademark-images` vs. image rows → orphaned files (delete with token) and missing files (broken references) |
| `/admin/audit` | **Audit Log** | `admin_actions` (who / when / action / target ids / serials / paths / batch / counts / status / details, CSV) and `audit_logs` (trigger-based row changes) |

"Other data" (users, roles, configuration) is deliberately **not** deletable from the UI; roles are
managed in the Supabase dashboard (`public.user_roles`).

## 2. Safe-deletion model

Every destructive button opens one confirmation dialog that states:

* **what** (item type and count), the exact **serial numbers / file names / paths** (first 40),
* **dependents** (linked image rows, Storage files, item-report lines, rows that will *not* be touched),
* **reversibility** — *Reversible* (archive = `is_published=false`, hidden from the public site and
  search, restorable any time) vs. *This cannot be undone* (permanent delete; no recycle bin, restore
  only from your backup or by re-importing the source file),
* for permanent / bulk operations a **typed `DELETE`** field; the confirm button stays disabled until
  it matches, and the token is **re-checked server-side** (`p_confirm = 'DELETE'`, otherwise the RPC
  raises or — for batch deletion — returns a preview only).

Only the explicitly selected ids / paths are ever passed to the database; nothing is deleted by
pattern, by filter, or automatically.

### Database ↔ Storage consistency

1. `admin_delete_trademarks` / `admin_delete_images` / `admin_delete_import_job_records` delete the
   rows (FK cascade removes image rows and image-search features) **and enqueue every Storage path in
   `storage_cleanup_queue`** in the same transaction. The audit entry carries the exact paths.
2. The browser then removes the queued objects through the Storage API and marks them `done`; a
   rejected deletion stays `failed` with the error text and attempt count and can be retried from
   *Orphaned Files* (the queue is also visible in the Overview). Nothing is reported "deleted" that
   Storage still holds.
3. Shared objects are never removed: an image row is unique per `(bucket, path)`; the orphan scan
   re-checks each path against the database right before deletion (`admin_unreferenced_paths`) and
   skips paths that became referenced in the meantime.
4. Dangling references in the other direction (row without file) are listed under *Missing files*.

### Delete by import batch (provenance)

0600 adds `trademarks.created_by_job_id` / `trademark_images.created_by_job_id` (set once, never
overwritten; back-filled from `audit_logs` INSERT entries for rows imported earlier) next to the
existing `import_job_id` (= last job that touched the row). `admin_import_trademark_rows` now also
records an `import_job_items` line for every inserted/updated row (`changed[]` fields).

*Import History → Delete created records* therefore:

* deletes **only rows created by that job** (never rows that already existed and were merely updated),
* previews counts — trademarks, image rows, Storage files, *created but modified later* (by a later
  import or manually), *updated only (kept)* — before the token is typed,
* keeps later-modified rows unless the administrator ticks *also delete …*,
* reports what happened (`deleted / images / queued / skipped`) and logs it.

Jobs that ran before provenance existed show *Row provenance: No*; their records cannot be
batch-deleted (the dialog says so — nothing is guessed).

### Import record vs. records

* *Delete import record* removes only the `import_jobs` row and its item report — trademark data stays.
* Uploaded Excel/ZIP files are never stored, so "delete the source file" means nothing more than that.
* *Cancel import* marks a `queued/processing` job `failed`; `admin_import_trademark_rows` /
  `admin_register_images` refuse further rows for it (`55000`). Rows already written stay and are
  updated — not duplicated — by a re-import.
* *Clean up history* removes finished jobs older than *n* ≥ 7 days (token required); never data.

## 3. Audit log

* `public.admin_actions` — one row per administrative operation: `actor_id`, `actor_email`,
  `action`, `target_type`, `target_ids`, `serials`, `storage_paths`, `job_id`, `affected_count`,
  `status` (`success | partial | failed | preview`), `details` (jsonb). Written inside the mutating
  RPCs; client-side-only operations (orphan deletion, cleanup runs) log through `admin_log_action`.
* Both `admin_actions` and `audit_logs` are **append-only**: app roles have no UPDATE/DELETE grant and
  a trigger raises even for the table owner (`Rows of … are append-only; UPDATE is not allowed`).
* The Audit Log page shows both, with filters (action / job / table / operation / row id) and CSV export.

## 4. Authorisation and validation (server-side)

* Every `admin_*` function is `SECURITY DEFINER`, starts with `admin_assert()` (role `admin` or
  `editor` in `public.user_roles`, else `42501`), and `EXECUTE` is granted to `authenticated` only
  (`anon` → *permission denied*). RLS stays on for every table.
* Ids are typed `uuid[]`, limits are capped (≤ 200 / 1 000 per call), paths are validated
  (`^[0-9A-Za-z._/-]+$`, no `..`), the `DELETE` token is enforced in SQL, retention is ≥ 7 days.
* 0600 also hardens the **public API**: `anon`/`authenticated` get column-level `SELECT` on
  `trademarks` / `trademark_images` only for public columns — `attorney_or_representative`,
  `review_note`, `reviewed_*`, `review_comment`, `source_file/sheet/row`, `import_job_id`,
  `created_by_job_id`, `match_method`, `original_filename`, `source_folder`, `content_hash` are not
  readable through PostgREST any more (the web app never showed them; now the API cannot leak them
  either). `search_trademarks`, `similar_trademarks`, `recent_trademarks`,
  `search_trademarks_by_image` were recreated without the attorney column.
* Rate limiting: Supabase's platform limits apply to PostgREST/Auth; the app adds no extra limiter
  (static site, no server). Destructive RPCs are token-gated and capped per call instead.

## 5. Data protection

* **Take a backup before applying any migration or running bulk deletions**
  (Dashboard → Database → Backups, or `pg_dump`). `APPLY_0600.sql` says so in its header.
* 0600 is additive and idempotent: new columns/tables/functions/triggers/grants only — no table is
  dropped, no row is deleted or rewritten; `(official_gazette_number, serial_number)` uniqueness is kept.
* Nothing deletes automatically; there is no scheduled cleanup; retention cleanup is a manual,
  token-confirmed action limited to import history.
* Deleting an image never deletes a trademark; deleting an import record never deletes records;
  archiving deletes nothing.

## 6. Applying 0600 to the production project

1. Backup.
2. SQL Editor → paste **`supabase/APPLY_0600.sql`** → Run (one transaction; the result panel prints
   `data management functions = 21`, table checks, `anon sees attorney column = 0`, unchanged
   trademark counts).
3. `python3 scripts/check_supabase.py` → section *2d* must show the admin RPCs present and refused
   for anonymous callers, `admin_actions` / `storage_cleanup_queue` unreadable, attorney column not
   selectable.
4. Reload `/admin` — the "Migration 0600 has not been applied" notices disappear.

## 7. What was tested

* **SQL** (`/tmp` harness, PostgreSQL 17 + `supabase/dev/00_supabase_shim.sql`, all migrations):
  token enforcement, anon/viewer denials, admin-only grants, append-only triggers, cancel → late rows
  rejected, batch-delete preview/execute with modified-later detection, retention guard, column-level
  grants (`select *` denied, public columns allowed), public search functions attorney-free.
  `APPLY_ALL.sql` on a fresh database and `APPLY_0600.sql` twice on a populated database (12 rows,
  images, audit back-fill): rows unchanged, idempotent.
* **UI** (Playwright against the offline stack, all 10 admin routes, 0 console errors): archive /
  restore (bulk), permanent delete with typed token (button disabled until `DELETE`), image delete →
  queue, delete-by-batch (preview 3 created / 2 updated-only kept → exactly those 3 deleted), cancel
  stale job, retention purge, cleanup queue run, Storage scan → orphan deletion (logged with path),
  audit log entries for every action, unmatched files list, Dari/Pashto RTL, 390 px mobile layout.
* **Excel import through the UI** with a 21-column workbook: all 21 headers auto-mapped, leading-zero
  serial `0048-001` kept, multi-class `29, 30` kept, empty cells → `N/A`, registration/application
  numbers stored, missing serial + in-file duplicate rejected and listed, counts 3 inserted / 2
  failed, re-import → 0 inserted / 3 unchanged (no duplicates), provenance set.

Known limits: the orphan scan lists at most 20 000 objects per run (reported as *truncated*); the
local Storage stand-in (`scripts/local-stack/static_storage.py`) emulates list/remove only for
development; production uses Supabase Storage.
