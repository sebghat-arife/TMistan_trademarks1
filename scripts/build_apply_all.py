#!/usr/bin/env python3
"""Rebuild supabase/APPLY_ALL.sql (0100 → 0200 → 0300 → 0400) and supabase/APPLY_0400.sql (0400 only)."""
import pathlib
root = pathlib.Path(__file__).resolve().parents[1]
files = sorted(p for p in (root / "supabase" / "migrations").glob("20260905000[1234]00_*.sql"))
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
