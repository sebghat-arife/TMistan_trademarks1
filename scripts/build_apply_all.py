#!/usr/bin/env python3
"""Rebuild supabase/APPLY_ALL.sql (0100 → 0200 → 0300 → 0400 → 0500), supabase/APPLY_0400.sql (0400 only) and supabase/APPLY_0500.sql (0500 only)."""
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
