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
2. The browser then removes the queued objects through the Storage API — right after the deletion
   for the paths of that action (the confirmation message says how many were removed on the spot)
   and otherwise from *Orphaned Files* — and marks them `done`; a rejected deletion stays `failed`
   with the error text and attempt count and can be retried (the queue is also visible in the
   Overview). Nothing is reported "deleted" that Storage still holds.
3. Shared or re-used objects are never removed: an image row is unique per `(bucket, path)`; every
   queue run and the orphan scan re-check each path against the database right before deletion
   (`admin_unreferenced_paths`) and mark paths that became referenced in the meantime `skipped`
   ("file in use again"). Migration 1000 enforces the same rule in the database
   (`admin_storage_cleanup_list` skips referenced entries before listing, `admin_register_images`
   cancels queued removals of a path it registers), so an image re-uploaded for the same serial
   number after a deletion can no longer be destroyed by a later cleanup run. New uploads are
   stored under content-addressed paths (`<gazette>/<serial>-<hash>.<ext>`), so a corrected picture
   never shares a path with the deleted one anyway (see `docs/IMPORT_CENTER.md`).
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

## 8. Direct record editing (migration 1100)

**Where.** Admin → Trademark Records → open a record → **Edit record** (header of the details panel
and its action row). The form replaces the read-only details *inside the same panel*; the search
toolbar, table, images and change history are untouched. Sections: Identification · Mark ·
Applicant & ownership · Goods, services & source page · *Administrator-only fields* (attorney /
representative, note, review comment, review status, published flag — amber box, never public) ·
System information (read-only: source file / sheet / row, import batch, created, updated, id).
Only columns that already exist on `public.trademarks` are exposed; nothing was invented.

**Persistence path.** `TrademarkEditForm` → `updateTrademark()` (`admin_data_service.ts`) →
RPC **`admin_update_trademark(p_id, p_patch, p_expected_updated_at, p_reason, p_release_protection)`**
(migration `20261021001100_record_editing.sql`). The patch contains *only the fields that differ*
from the loaded row; the row is located by its immutable `id` (never by serial, name or row
number) and locked `FOR UPDATE`. The function returns the updated row, which the panel shows
immediately; the TanStack queries for the table, the record, the admin stats and the public search
are invalidated (no page reload). Success is shown only after the database has confirmed.

**Enforced in the database, not the UI**

* `admin_assert()` → non-administrators get `42501` (anonymous callers cannot even execute the
  function — no grant to `anon`).
* Whitelist of editable columns; `id`, `source_file/sheet/row`, import job ids, `created_at`,
  `updated_at`, `reviewed_*`, `search_vector` are never writable.
* Values are trimmed, `''` → `NULL` (legitimate empty values stay empty), dates and
  `review_status` validated (`22023`), serial / gazette number required (`23502`), text length capped.
* **Optimistic concurrency** — the client sends the `updated_at` it loaded; if the row changed in
  between the save is refused with SQLSTATE `PT409` (HTTP 409, hint `stale`) and *nothing is
  overwritten*. The form offers *Reload latest version (keeps your edits)*, re-applies the
  administrator's changes on top of the fresh row and lets them save again.
* **Duplicate identifier** — a new `(official_gazette_number, serial_number)` pair that already
  exists is refused (`PT409`, hint `duplicate`, the other record in `DETAIL`); the form names that
  record and offers to open it. A second record can never be created by editing.
* Deleted record → `P0002`; the form says so and keeps the input.

**Images.** `trademark_images` rows, Storage paths, counts and previews are untouched by an edit —
the relation is by `trademark_id`. If the serial or gazette number of a record is changed, only the
denormalised labels (`serial_number` / `gazette_number`) on its *existing* image rows are
refreshed; no file is moved, renamed or deleted. Image management stays a separate action.

**Audit trail.** Every save writes one `admin_actions` row (`trademarks.edit`: changed fields,
before/after values, optional reason, `protection_released`) *and* the existing row-level
`audit_logs` trigger entry. Both tables are append-only and admin-only. The panel's *Change
history* lists manual edits with the fields, the reason and `old → new` values; the Audit Log page
shows them under action `trademarks.edit`.

**Manual corrections vs. later Excel imports.** Fields edited by hand are recorded in
`trademarks.manual_edit_fields` (+ `manual_edited_at`, `manual_edited_by`). When the same serial is
imported again, `admin_import_trademark_rows` **keeps those fields** and applies the Excel values
to all other columns; its result carries `preserved` / `preserved_rows` and the Import Center
prints *"N field(s) on M record(s) kept their manual TMistan corrections…"* — never a silent
overwrite. A record with protected fields shows the *Manually corrected* pill and the list of
protected fields; the editor's *Let future Excel imports overwrite…* checkbox releases the
protection (logged). Import matching logic itself is unchanged (gazette + serial, then serial).

**Until 1100 is applied in production** the frontend probes the function once per session
(`recordEditingReady`): the Edit button stays disabled and the panel shows *"Record editing is not
available yet: Migration 1100 … paste supabase/APPLY_1100.sql"*; everything else keeps working.

**Applying:** SQL Editor → paste **`supabase/APPLY_1100.sql`** → Run (prerequisite 0600; the result
panel prints `provenance columns = 3`, `admin_update_trademark present = 1`, `callable by anon = 0`,
unchanged record / image counts). Idempotent.

**Tested (2026-10-21, local PostgreSQL 17 + PostgREST + the real web app — never production):**

* SQL harness `supabase/dev/test_1100_record_editing.sql` — 60 checks: whitelist, trim/empty
  handling, date/status validation, required identifiers, non-admin `42501`, stale `PT409`,
  duplicate `PT409`, images and provenance unchanged, `admin_actions` + `audit_logs` rows,
  re-import preserving manual fields (`preserved` counts), protection release, idempotent migration.
* Browser (Playwright, 1440 px and 390 px, 23 checks each): basic edit → DB row, table and panel
  updated; persistence after reload; public search finds the new mark name and applicant; four
  fields in one save; cancel with unsaved input → confirmation, DB unchanged; two linked images
  (rows, paths, previews, table count) intact; admin-only `review_note` saved but not readable
  through the public API; anonymous RPC call refused; empty serial flagged inline, duplicate serial
  refused by the database with the other record named (still 4 records); concurrent change by a
  second administrator → stale save refused, reload keeps the edit and shows the other change, save
  succeeds; Dari + Latin mark name round-trips byte-exact; change history shows fields, reason and
  before → after; Import Center re-import of the edited serial → *5 field(s) on 1 record(s) kept
  their manual corrections*, non-protected column updated, no duplicate record; function hidden →
  Edit button disabled with the migration notice, no page errors.
