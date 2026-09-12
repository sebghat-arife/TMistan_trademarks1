#!/usr/bin/env python3
"""Rebuild supabase/APPLY_ALL.sql from the individual migrations (0100 → 0200 → 0300)."""
import pathlib
root = pathlib.Path(__file__).resolve().parents[1]
files = sorted(p for p in (root / "supabase" / "migrations").glob("20260905000[123]00_*.sql"))
header = (root / "supabase" / "APPLY_ALL.sql").read_text().split("begin;")[0] + "begin;\n"
body = "".join(f"\n-- {'#'*76}\n-- {p.name}\n-- {'#'*76}\n" + p.read_text() for p in files)
footer = "\n-- post-checks\ncommit;\n" + (root / "supabase" / "APPLY_ALL.sql").read_text().split("commit;")[-1]
(root / "supabase" / "APPLY_ALL.sql").write_text(header + body + footer)
print("wrote supabase/APPLY_ALL.sql from", [p.name for p in files])
