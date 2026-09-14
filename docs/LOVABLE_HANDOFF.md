# Lovable hand-off prompt (if you continue Phase 2+ in Lovable)

Paste the block below as the first message. It binds Lovable to this repository's schema
and rules so it extends the app rather than re-inventing it.

---

**Supabase is the canonical source of truth for this application.** Before creating or modifying
anything, inspect the existing Supabase schema and data. Do not create mock data or a parallel
database. Preserve the existing trademark records and the uniqueness rule
`(official_gazette_number, serial_number)`. All functionality reads from and writes to Supabase
under Row Level Security. Any schema change must be an explicit, reviewable SQL migration added to
`supabase/migrations/` — never an ad-hoc change.

The database holds only what administrators import through Admin → Import Center (real gazette
Excel/CSV files + images) and will grow to 200+ gazettes. Design for continuous ingestion, not a
fixed dataset — never assume a record count.

**What already exists (do not recreate):**

- Tables: `trademarks` (with generated `*_normalized` columns, `class_numbers int[]`, `search_vector`,
  `review_status`, `is_published`), `gazettes`, `trademark_images`, `import_jobs`, `import_job_items`,
  `audit_logs`, `user_roles`.
- Views: `gazette_summaries`, `trademark_primary_images`.
- RPCs: `search_trademarks(p_query, p_mark, p_applicant, p_serial, p_gazette, p_classes int[], p_goods,
  p_application_type, p_attorney, p_date_from, p_date_to, p_fuzzy, p_sort, p_limit, p_offset)` →
  rows include `total_count` and primary image paths; `similar_trademarks(p_id, p_limit)`;
  `trademark_filter_options()`; `registry_stats()`.
- RLS: anon/authenticated read published rows and matched images; `public.is_admin()` gates writes;
  no DELETE via API. Storage buckets `trademark-images` (public) and `source-documents` (private).
- Frontend (React + TS + Vite + Tailwind + shadcn-style components + TanStack Query + React Router + i18next):
  `/`, `/search`, `/trademark/:serial`, `/gazettes`, `/gazette/:number`, `/about`. URL is the search
  state. EN / Dari / Pashto with RTL. Images render via `storagePublicUrl(bucket, path)`.
- Ingestion: **Admin → Import Center** in the browser (`web/src/pages/admin/ImportCenterPage.tsx`,
  `docs/IMPORT_CENTER.md`) through admin-only `SECURITY DEFINER` RPCs (migration 0400:
  `admin_import_trademark_rows`, `admin_resolve_serials`, `admin_register_images`, job bookkeeping) and
  admin-only Storage policies; images are matched by the serial number in the file name. An optional
  Python folder importer (`importers/image_importer.py`) exists for operator machines.
- Auth + `/admin` shell + dashboard + Import Center are done; the remaining admin screens
  (trademark editing, review queue, users) are still to build.

**Phase 2 scope (build in this order, one PR each):**

1. Auth (Supabase Auth, email + password) and an `/admin` shell that is only rendered when
   `select is_admin()` returns true. Non-admins get a 404, not a login wall on public pages.
2. `/admin` dashboard: `registry_stats()` + latest 10 `import_jobs` + counts of
   `trademark_images where status <> 'matched'` and `trademarks where review_status in ('unreviewed','needs_correction')`.
3. `/admin/reviews`: list + edit form for a trademark. Editing writes only the fields the user changed
   (`update … where id = …`); the audit trigger records the diff. Provide the original source
   (file/sheet/row/page) read-only beside the form. Set `review_status`, `reviewed_by = auth.uid()`, `reviewed_at = now()`.
4. `/admin/images`: review queue for `unmatched` / `ambiguous` images — show the image, let the admin
   pick the trademark by serial (server search), then update the row (`trademark_id`, `status='matched'`,
   `match_method='manual'`). Never auto-assign.
5. `/admin/imports` and `/admin/audit-log`: read-only tables over `import_jobs` (+ items drill-down) and `audit_logs`.

**Do not:** create mock data or fake logos; hard-code counts; store service-role keys anywhere in the
frontend; filter the whole table in JavaScript; translate mark names or applicant names; overwrite
official data with AI output; upload images from the browser in bulk; add migrations that drop or
rename existing columns.
