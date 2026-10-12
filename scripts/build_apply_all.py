#!/usr/bin/env python3
"""Rebuild supabase/APPLY_ALL.sql (0100 → 0200 → 0300 → 0400 → 0500 → 0600), supabase/APPLY_0400.sql (0400 only), supabase/APPLY_0500.sql (0500 only) and supabase/APPLY_0600.sql (0600 only)."""
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
