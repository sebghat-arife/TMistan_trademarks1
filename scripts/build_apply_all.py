#!/usr/bin/env python3
"""Rebuild supabase/APPLY_ALL.sql (0100 → … → 1200) and the single-migration files APPLY_0400.sql … APPLY_1200.sql."""
import pathlib
root = pathlib.Path(__file__).resolve().parents[1]
files = sorted(p for p in (root / "supabase" / "migrations").glob("202*_*.sql") if not p.name.startswith("20260905000000"))
header = (root / "supabase" / "APPLY_ALL.sql").read_text().split("begin;")[0] + "begin;\n"
body = "".join(f"\n-- {'#'*76}\n-- {p.name}\n-- {'#'*76}\n" + p.read_text() for p in files)
footer = "\n-- post-checks\ncommit;\n" + (root / "supabase" / "APPLY_ALL.sql").read_text().split("commit;")[-1]
(root / "supabase" / "APPLY_ALL.sql").write_text(header + body + footer)
print("wrote supabase/APPLY_ALL.sql from", [p.name for p in files])

# APPLY_0400.sql — the Import Center migration on its own, for projects that already run 0100–0300.
m0400 = root / "supabase" / "migrations" / "20260905000400_admin_import.sql"
p0400 = root / "supabase" / "APPLY_0400.sql"
h0400 = p0400.read_text().split("begin;")[0] + "begin;\n"
f0400 = "\ncommit;" + p0400.read_text().split("\ncommit;")[-1]
p0400.write_text(h0400 + f"\n-- {'#'*76}\n-- {m0400.name}\n-- {'#'*76}\n" + m0400.read_text() + f0400)
print("wrote supabase/APPLY_0400.sql")

# APPLY_0500.sql — Search by Image (pgvector) on its own, for projects that already run 0100–0400.
m0500 = root / "supabase" / "migrations" / "20261011000500_image_search.sql"
p0500 = root / "supabase" / "APPLY_0500.sql"
h0500 = p0500.read_text().split("begin;")[0] + "begin;\n"
f0500 = """
commit;

-- post-checks -------------------------------------------------------------
select 'pgvector extension'    as object, count(*)::text as value from pg_extension where extname = 'vector'
union all select 'image feature table', (select count(*)::text from pg_tables where schemaname = 'public' and tablename = 'trademark_image_features')
union all select 'image search functions', (select count(*)::text from pg_proc where proname in ('search_trademarks_by_image','image_search_status','admin_image_index_status','admin_images_missing_features','admin_upsert_image_features'))
union all select 'trademarks',           count(*)::text from public.trademarks;
"""
p0500.write_text(h0500 + f"\n-- {'#'*76}\n-- {m0500.name}\n-- {'#'*76}\n" + m0500.read_text() + f0500)
print("wrote supabase/APPLY_0500.sql")

# APPLY_0600.sql — Admin Data Management on its own, for projects that already run 0100–0500.
m0600 = root / "supabase" / "migrations" / "20261012000600_data_management.sql"
p0600 = root / "supabase" / "APPLY_0600.sql"
h0600 = """-- ============================================================================
-- TMistan — APPLY MIGRATION 0600 (Admin Data Management Center)
--
-- Paste this whole file into the Supabase SQL Editor and click RUN once.
-- Generated from supabase/migrations/20261012000600_data_management.sql by
-- scripts/build_apply_all.py — do not edit by hand, edit the migration.
--
-- Prerequisite: migrations 0100–0500 (APPLY_ALL.sql, APPLY_0400.sql,
-- APPLY_0500.sql) are in place.
--
-- RECOMMENDED FIRST: Supabase Dashboard → Database → Backups → take a backup
-- (or `pg_dump`) before running any migration against production.
--
-- Safe by construction — ADDITIVE ONLY:
--   • ADDs columns trademarks.registration_number / application_number /
--     created_by_job_id and trademark_images.created_by_job_id
--   • ADDs two tables (admin_actions, storage_cleanup_queue), the admin_*
--     data-management functions and the append-only audit triggers
--   • REPLACES the public search functions with attorney-free versions and
--     restricts anon/authenticated SELECT to the public columns
--     (attorney, review notes, source file/sheet/row are no longer readable
--     through the public API — the web app already never shows them)
--   • never drops a table, never deletes or rewrites a trademark row
--   • idempotent — running it twice is harmless
--
-- Afterwards: sign in → /admin → every Data Management page replaces the
-- "Migration 0600 has not been applied" notice with live data.
-- ============================================================================
begin;
"""
f0600 = """
commit;

-- post-checks -------------------------------------------------------------
select 'data management functions' as object,
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('admin_data_overview','admin_search_trademarks','admin_get_trademark',
               'admin_delete_trademarks','admin_set_trademarks_published','admin_delete_images','admin_list_images',
               'admin_list_import_jobs','admin_import_job_detail','admin_import_job_records','admin_delete_import_job_records',
               'admin_delete_import_job','admin_cancel_import_job','admin_purge_import_jobs','admin_list_admin_actions',
               'admin_list_audit_logs','admin_storage_cleanup_list','admin_storage_cleanup_mark','admin_unreferenced_paths',
               'admin_image_storage_paths','admin_log_action')) as value
union all select 'expected functions',  '21'
union all select 'admin_actions table', (select count(*)::text from pg_tables where schemaname = 'public' and tablename = 'admin_actions')
union all select 'cleanup queue table', (select count(*)::text from pg_tables where schemaname = 'public' and tablename = 'storage_cleanup_queue')
union all select 'new trademark columns', (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'trademarks' and column_name in ('registration_number','application_number','created_by_job_id'))
union all select 'anon sees attorney column', (select count(*)::text from information_schema.column_privileges where table_schema = 'public' and table_name = 'trademarks' and column_name = 'attorney_or_representative' and grantee = 'anon' and privilege_type = 'SELECT')
union all select 'trademarks (unchanged)', count(*)::text from public.trademarks
union all select 'published trademarks', (select count(*)::text from public.trademarks where is_published);
"""
p0600.write_text(h0600 + f"\n-- {'#'*76}\n-- {m0600.name}\n-- {'#'*76}\n" + m0600.read_text() + f0600)
print("wrote supabase/APPLY_0600.sql")

# APPLY_0700.sql — search by application / registration number, for projects already on 0100–0600.
m0700 = root / "supabase" / "migrations" / "20261013000700_search_numbers.sql"
p0700 = root / "supabase" / "APPLY_0700.sql"
h0700 = """-- ============================================================================
-- TMistan — APPLY MIGRATION 0700 (search by application / registration number)
--
-- Paste this whole file into the Supabase SQL Editor and click RUN once.
-- Generated from supabase/migrations/20261013000700_search_numbers.sql by
-- scripts/build_apply_all.py — do not edit by hand, edit the migration.
--
-- Prerequisite: migration 0600 (APPLY_0600.sql) is in place — it adds the
-- trademarks.application_number / registration_number columns.
--
-- Safe by construction — FUNCTION ONLY:
--   • re-creates public.search_trademarks() with two extra optional
--     parameters (p_application_number, p_registration_number) and lets the
--     keyword search match those two columns
--   • touches no table, column, index, policy, storage object or data row
--   • idempotent — running it twice is harmless
--
-- Afterwards: Search → Advanced search → "Application number" and
-- "Registration number" become editable, and typing a number into the main
-- search box finds the record. Nothing else changes.
-- ============================================================================
begin;
"""
f0700 = """
commit;

-- post-checks -------------------------------------------------------------
select 'search_trademarks overloads (must be 1)' as object,
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'search_trademarks') as value
union all select 'has p_application_number',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'search_trademarks'
           and 'p_application_number' = any(p.proargnames))
union all select 'anon may execute',
       (select count(*)::text from information_schema.routine_privileges
         where specific_schema = 'public' and routine_name = 'search_trademarks' and grantee = 'anon' and privilege_type = 'EXECUTE')
union all select 'trademarks (unchanged)', count(*)::text from public.trademarks
union all select 'published trademarks', (select count(*)::text from public.trademarks where is_published);
"""
p0700.write_text(h0700 + f"\n-- {'#'*76}\n-- {m0700.name}\n-- {'#'*76}\n" + m0700.read_text() + f0700)
print("wrote supabase/APPLY_0700.sql")

# APPLY_0800.sql — Contact & Feedback inbox, for projects already on 0100–0600 (0700 not required).
m0800 = root / "supabase" / "migrations" / "20261013000800_contact_requests.sql"
p0800 = root / "supabase" / "APPLY_0800.sql"
h0800 = """-- ============================================================================
-- TMistan — APPLY MIGRATION 0800 (Contact & Feedback form + admin Inquiries inbox)
--
-- Paste this whole file into the Supabase SQL Editor and click RUN once.
-- Generated from supabase/migrations/20261013000800_contact_requests.sql by
-- scripts/build_apply_all.py — do not edit by hand, edit the migration.
--
-- Prerequisites: 0400 (admin_assert) and 0600 (admin_record_action) are in
-- place. 0700 is NOT required.
--
-- Safe by construction — ADDITIVE ONLY:
--   • adds ONE new private table public.contact_requests (RLS on, no
--     policies, no grants — nobody can read it through the API)
--   • adds the public function submit_contact_request() (server-side
--     validation, rate limiting, honeypot) and contact_form_status()
--   • adds admin-only functions admin_contact_counts / admin_list_contact_requests /
--     admin_get_contact_request / admin_update_contact_request (admin_assert)
--   • touches no existing table, column, index, policy, storage object or data row
--   • idempotent — running it twice is harmless
--
-- Afterwards: /contact actually accepts submissions (until then it shows
-- "The inquiry form is not available yet") and Admin → Inquiries lists them.
-- ============================================================================
begin;
"""
f0800 = """
commit;

-- post-checks -------------------------------------------------------------
select 'contact_requests table' as object,
       (select count(*)::text from pg_tables where schemaname = 'public' and tablename = 'contact_requests') as value
union all select 'RLS enabled',
       (select relrowsecurity::text from pg_class where oid = 'public.contact_requests'::regclass)
union all select 'anon/authenticated table grants (must be 0)',
       (select count(*)::text from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'contact_requests' and grantee in ('anon', 'authenticated'))
union all select 'anon may call submit_contact_request',
       (select count(*)::text from information_schema.routine_privileges
         where specific_schema = 'public' and routine_name = 'submit_contact_request' and grantee = 'anon' and privilege_type = 'EXECUTE')
union all select 'contact functions',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('contact_form_status','submit_contact_request','admin_contact_counts','admin_list_contact_requests','admin_get_contact_request','admin_update_contact_request'))
union all select 'trademarks (unchanged)', count(*)::text from public.trademarks;
"""
p0800.write_text(h0800 + f"\n-- {'#'*76}\n-- {m0800.name}\n-- {'#'*76}\n" + m0800.read_text() + f0800)
print("wrote supabase/APPLY_0800.sql")

# APPLY_0900.sql — Data Correction & Verification requests, for projects already on 0100–0600 (0700/0800 not required).
m0900 = root / "supabase" / "migrations" / "20261013000900_correction_requests.sql"
p0900 = root / "supabase" / "APPLY_0900.sql"
h0900 = """-- ============================================================================
-- TMistan — APPLY MIGRATION 0900 (Data Correction & Verification Requests + admin queue)
--
-- Paste this whole file into the Supabase SQL Editor and click RUN once.
-- Generated from supabase/migrations/20261013000900_correction_requests.sql by
-- scripts/build_apply_all.py — do not edit by hand, edit the migration.
--
-- Prerequisites: 0400 (admin_assert, is_admin) and 0600 (admin_record_action)
-- are in place. 0700 and 0800 are NOT required.
--
-- Safe by construction — ADDITIVE ONLY:
--   • adds TWO new private tables public.correction_requests and
--     public.correction_request_events (RLS on, no policies, no grants —
--     nobody can read them through the API)
--   • adds the public functions correction_form_status(),
--     submit_correction_request() (server-side validation, rate limiting,
--     honeypot, non-sequential reference), correction_request_status()
--     (needs reference + e-mail) and correction_upload_allowed()
--   • adds admin-only functions admin_correction_counts /
--     admin_list_correction_requests / admin_get_correction_request /
--     admin_update_correction_request (admin_assert, validated status
--     transitions, history rows, audit log)
--   • Storage: creates the PRIVATE bucket `correction-evidence` (5 MB,
--     JPG/PNG/PDF) and three storage.objects policies (visitor upload within
--     15 minutes of a submission, admin read/delete). If the SQL editor role
--     may not write storage.buckets you will see a NOTICE — then run
--     `python3 scripts/setup_storage.py` once from a trusted machine (uses
--     the secret key, never the browser) and re-run this file for the policies.
--   • touches no existing table, column, index, policy, storage object or
--     data row; visitors can never write to public.trademarks
--   • idempotent — running it twice is harmless
--
-- Afterwards: /data-corrections accepts requests (until then it shows
-- "The request form is not available yet") and Admin → Data Corrections
-- lists them.
-- ============================================================================
begin;
"""
f0900 = """
commit;

-- post-checks -------------------------------------------------------------
select 'correction tables' as object,
       (select count(*)::text from pg_tables where schemaname = 'public' and tablename in ('correction_requests', 'correction_request_events')) as value
union all select 'RLS enabled (requests)',
       (select relrowsecurity::text from pg_class where oid = 'public.correction_requests'::regclass)
union all select 'anon/authenticated table grants (must be 0)',
       (select count(*)::text from information_schema.role_table_grants
         where table_schema = 'public' and table_name in ('correction_requests', 'correction_request_events') and grantee in ('anon', 'authenticated'))
union all select 'anon may call submit_correction_request',
       (select count(*)::text from information_schema.routine_privileges
         where specific_schema = 'public' and routine_name = 'submit_correction_request' and grantee = 'anon' and privilege_type = 'EXECUTE')
union all select 'correction functions (expect 8)',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('correction_form_status','submit_correction_request','correction_request_status','correction_upload_allowed',
               'admin_correction_counts','admin_list_correction_requests','admin_get_correction_request','admin_update_correction_request'))
union all select 'bucket correction-evidence (expect 1; else run scripts/setup_storage.py)',
       (select count(*)::text from storage.buckets where id = 'correction-evidence')
union all select 'storage policies (expect 3)',
       (select count(*)::text from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'tmistan % correction evidence')
union all select 'trademarks (unchanged)', count(*)::text from public.trademarks;
"""
p0900.write_text(h0900 + f"\n-- {'#'*76}\n-- {m0900.name}\n-- {'#'*76}\n" + m0900.read_text() + f0900)
print("wrote supabase/APPLY_0900.sql")

# APPLY_1000.sql — image re-upload fix (cleanup-queue guard + lookup RPC), for projects already on 0100–0600.
m1000 = root / "supabase" / "migrations" / "20261014001000_image_reupload_fix.sql"
p1000 = root / "supabase" / "APPLY_1000.sql"
h1000 = """-- ============================================================================
-- TMistan — APPLY MIGRATION 1000 (image re-upload fix: Storage cleanup guard)
--
-- Paste this whole file into the Supabase SQL Editor and click RUN once.
-- Generated from supabase/migrations/20261014001000_image_reupload_fix.sql by
-- scripts/build_apply_all.py — do not edit by hand, edit the migration.
--
-- Prerequisite: migration 0600 (APPLY_0600.sql) is in place — it created
-- storage_cleanup_queue and the functions re-defined here. 0700–0900 are NOT
-- required.
--
-- What it fixes: deleting an image only QUEUED the removal of its Storage
-- file; an image re-uploaded for the same serial number re-used that path, so
-- running the cleanup queue later deleted the NEW picture as well. From now on
--   • admin_register_images cancels a queued removal of any path it registers
--   • admin_storage_cleanup_list marks every queued path that is referenced
--     by a current image row as `skipped` before listing (never removable)
--   • admin_trademark_images_lookup lets the Import Center plan uploads
--     against the images a trademark already has
--   • queue entries that already point at a live image are marked `skipped`
--     once (one-off data fix of the queue table only — no trademark or image
--     row and no Storage object is touched)
--
-- Safe by construction — ADDITIVE ONLY:
--   • re-creates four admin functions (same names/signatures, same callers)
--   • adds one admin-only function and one internal helper (no API grant)
--   • touches no trademark, gazette, applicant or image row, no Storage object
--   • idempotent — running it twice is harmless
-- ============================================================================
begin;
"""
f1000 = """
commit;

-- post-checks -------------------------------------------------------------
select 'functions (expect 5)' as object,
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('admin_register_images','admin_storage_cleanup_list','admin_storage_cleanup_mark',
               'admin_trademark_images_lookup','admin_cancel_storage_cleanup')) as value
union all select 'internal helper callable by anon/authenticated (must be 0)',
       (select count(*)::text from information_schema.routine_privileges
         where specific_schema = 'public' and routine_name = 'admin_cancel_storage_cleanup' and grantee in ('anon', 'authenticated', 'PUBLIC'))
union all select 'queue entries still pending that point at a live image (must be 0)',
       (select count(*)::text from public.storage_cleanup_queue q
         where q.status in ('pending', 'failed')
           and exists (select 1 from public.trademark_images i
                        where i.storage_bucket = q.bucket and (i.storage_path = q.path or i.thumbnail_path = q.path)))
union all select 'queue entries skipped by this migration',
       (select count(*)::text from public.storage_cleanup_queue where last_error like 'skipped by migration 1000:%')
union all select 'image rows (unchanged)', count(*)::text from public.trademark_images
union all select 'trademarks (unchanged)', count(*)::text from public.trademarks;
"""
p1000.write_text(h1000 + f"\n-- {'#'*76}\n-- {m1000.name}\n-- {'#'*76}\n" + m1000.read_text() + f1000)
print("wrote supabase/APPLY_1000.sql")

# APPLY_1100.sql — direct record editing (admin_update_trademark + manual-edit protection), for projects already on 0100–0600.
m1100 = root / "supabase" / "migrations" / "20261021001100_record_editing.sql"
p1100 = root / "supabase" / "APPLY_1100.sql"
h1100 = """-- ============================================================================
-- TMistan — APPLY MIGRATION 1100 (direct trademark record editing)
--
-- Paste this whole file into the Supabase SQL Editor and click RUN once.
-- Generated from supabase/migrations/20261021001100_record_editing.sql by
-- scripts/build_apply_all.py — do not edit by hand, edit the migration.
--
-- Prerequisite: migration 0600 (APPLY_0600.sql) is in place — it created
-- admin_actions / admin_record_action and admin_get_trademark, which this
-- migration builds on. 0700–1000 are NOT required (but recommended).
--
-- What it adds: the "Edit record" button of Admin → Trademark Records.
--   • admin_update_trademark(id, patch, expected_updated_at, reason, release)
--     – the only write path for single-record corrections: administrator
--     role checked in the database, row located by its immutable uuid,
--     whitelist of editable columns, optimistic concurrency (HTTP 409 when
--     somebody else saved first — nothing is overwritten), duplicate
--     gazette + serial rejected with the other record named, every save
--     written to admin_actions (fields, before/after, reason) and audit_logs
--   • three provenance columns on public.trademarks
--     (manual_edit_fields, manual_edited_at, manual_edited_by) — fields
--     corrected by hand are KEPT when the Excel file is imported again; the
--     Import Center reports how many values were preserved
--   • admin_get_trademark returns the new columns
--
-- Safe by construction — ADDITIVE ONLY:
--   • adds three nullable columns (no rewrite of existing rows, no defaults
--     that touch data), one admin-only function, re-creates two existing
--     functions with the same names, signatures and callers
--   • touches no trademark, gazette, applicant or image row, no Storage object
--   • idempotent — running it twice is harmless
--
-- Until this file is applied the web app keeps working: the Edit button is
-- disabled and the record panel explains that migration 1100 is missing.
-- ============================================================================
begin;
"""
f1100 = """
commit;

-- post-checks -------------------------------------------------------------
select 'provenance columns (expect 3)' as object,
       (select count(*)::text from information_schema.columns
         where table_schema = 'public' and table_name = 'trademarks'
           and column_name in ('manual_edit_fields','manual_edited_at','manual_edited_by')) as value
union all select 'admin_update_trademark present (expect 1)',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'admin_update_trademark')
union all select 'admin_update_trademark callable by anon (must be 0)',
       (select count(*)::text from information_schema.routine_privileges
         where specific_schema = 'public' and routine_name = 'admin_update_trademark' and grantee in ('anon', 'PUBLIC'))
union all select 'manually corrected records so far (0 right after applying)',
       (select count(*)::text from public.trademarks where manual_edit_fields is not null and cardinality(manual_edit_fields) > 0)
union all select 'image rows (unchanged)', count(*)::text from public.trademark_images
union all select 'trademarks (unchanged)', count(*)::text from public.trademarks;
"""
p1100.write_text(h1100 + f"\n-- {'#'*76}\n-- {m1100.name}\n-- {'#'*76}\n" + m1100.read_text() + f1100)
print("wrote supabase/APPLY_1100.sql")

# APPLY_1200.sql — intelligent image search (OCR text + CLIP embeddings + hybrid ranking), for projects already on 0100–0600.
m1200 = root / "supabase" / "migrations" / "20261027001200_intelligent_image_search.sql"
p1200 = root / "supabase" / "APPLY_1200.sql"
h1200 = """-- ============================================================================
-- TMistan — APPLY MIGRATION 1200 (intelligent image search)
--
-- Paste this whole file into the Supabase SQL Editor and click RUN once.
-- Generated from supabase/migrations/20261027001200_intelligent_image_search.sql
-- by scripts/build_apply_all.py — do not edit by hand, edit the migration.
--
-- Prerequisite: migrations 0100–0600 are in place (0500 created the pgvector
-- extension and trademark_image_features; 0600 the admin audit helpers).
-- 0700–1100 are NOT required.
--
-- Safe by construction — ADDITIVE ONLY:
--   • creates the table trademark_image_analysis (OCR words + normalised text
--     + 512-d CLIP embedding per image, with status / model version / error),
--     RLS enabled and no public policy — only the functions below read it
--   • creates text_match / phonetic_key helpers and the public, read-only
--     search_trademarks_hybrid() + hybrid_image_search_status()
--   • creates the admin / service indexing RPCs (admin_image_analysis_status,
--     admin_image_analysis_pending, admin_upsert_image_analysis); every one
--     calls admin_assert() unless invoked with the service role
--   • tries to enable the optional fuzzystrmatch extension (phonetic keys);
--     continues without it if the project does not offer it
--   • never drops a table, never deletes or rewrites a trademark / image row,
--     never touches Storage objects; the 0500 image search keeps working
--   • idempotent — running it twice is harmless
--
-- Afterwards: deploy the vision service (services/vision, see
-- docs/IMAGE_SEARCH.md), set VISION_API_URL on the static site, then
-- /admin → Import Center → "Intelligent image index" → Run batch.
-- ============================================================================
begin;
"""
f1200 = """
commit;

-- post-checks -------------------------------------------------------------
select 'analysis table (expect 1)' as object,
       (select count(*)::text from pg_tables where schemaname = 'public' and tablename = 'trademark_image_analysis') as value
union all select 'analysis table RLS enabled (expect t)',
       (select relrowsecurity::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = 'trademark_image_analysis')
union all select 'new functions (expect 7)',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('search_trademarks_hybrid','hybrid_image_search_status','text_match','phonetic_key',
               'admin_image_analysis_status','admin_image_analysis_pending','admin_upsert_image_analysis'))
union all select 'anon may run the hybrid search (expect 1)',
       (select count(*)::text from information_schema.routine_privileges
         where specific_schema = 'public' and routine_name = 'search_trademarks_hybrid' and grantee = 'anon' and privilege_type = 'EXECUTE')
union all select 'anon may run admin_upsert_image_analysis (must be 0)',
       (select count(*)::text from information_schema.routine_privileges
         where specific_schema = 'public' and routine_name = 'admin_upsert_image_analysis' and grantee in ('anon', 'PUBLIC'))
union all select 'fuzzystrmatch (1 = phonetic matching on)', (select count(*)::text from pg_extension where extname = 'fuzzystrmatch')
union all select 'hnsw index on embeddings (expect 1)', (select count(*)::text from pg_indexes where schemaname = 'public' and indexname = 'trademark_image_analysis_embedding_hnsw')
union all select 'matched images to index', (select count(*)::text from public.trademark_images where status = 'matched' and trademark_id is not null)
union all select 'image rows (unchanged)', count(*)::text from public.trademark_images
union all select 'trademarks (unchanged)', count(*)::text from public.trademarks;
"""
p1200.write_text(h1200 + f"\n-- {'#'*76}\n-- {m1200.name}\n-- {'#'*76}\n" + m1200.read_text() + f1200)
print("wrote supabase/APPLY_1200.sql")
