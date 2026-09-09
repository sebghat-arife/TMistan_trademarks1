#!/usr/bin/env python3
"""Verify that a Supabase project is ready for TMistan — using ONLY the public key.

    SUPABASE_URL=https://<ref>.supabase.co SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
        python3 scripts/check_supabase.py

Checks, in the order a browser would hit them:
  1. the REST endpoint answers with the key
  2. every table / view / RPC the web app calls exists (= migrations applied)
  3. anonymous users can actually read data (RLS policies applied)
  4. how many trademarks / gazettes / images are visible
  5. the public storage bucket exists

Exit code 0 = ready, 1 = something to fix (printed with the fix).
No dependencies beyond the standard library.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

URL = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
KEY = os.environ.get("SUPABASE_PUBLISHABLE_KEY") or os.environ.get("SUPABASE_ANON_KEY") or ""

TABLES = ["trademarks", "gazettes", "trademark_images", "gazette_summaries", "trademark_primary_images"]
RPCS = {
    "registry_stats": {},
    "recent_trademarks": {"p_limit": 1},
    "trademarks_by_class": {},
    "trademark_filter_options": {},
    "search_trademarks": {"p_limit": 1},
    "is_admin": {},
}


def call(method: str, path: str, body: dict | None = None, headers: dict | None = None) -> tuple[int, object, dict]:
    req = urllib.request.Request(
        f"{URL}{path}",
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json", **(headers or {})},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None), dict(r.headers)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw), dict(e.headers)
        except json.JSONDecodeError:
            return e.code, raw, dict(e.headers)


def main() -> int:
    problems: list[str] = []
    ok = lambda m: print(f"  ✓ {m}")  # noqa: E731
    bad = lambda m, fix: (print(f"  ✗ {m}\n      → {fix}"), problems.append(m))  # noqa: E731

    print(f"TMistan Supabase check — {URL or '(SUPABASE_URL not set)'}")
    if not URL or not KEY:
        print("  ✗ SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set in the environment.")
        return 1
    if KEY.startswith("sb_secret_") or '"service_role"' in _jwt_payload(KEY):
        print("  ✗ That is a SECRET / service-role key. Use the publishable (anon) key here and never in the web app.")
        return 1

    print("\n1. Connectivity")
    status, body, _ = call("GET", "/rest/v1/trademarks?select=id&limit=1")
    if status == 200:
        ok("REST endpoint reachable, key accepted")
    else:
        bad(f"REST returned {status}: {str(body)[:120]}", "Check the project URL and that the key is the publishable/anon key of THIS project.")
        return 1

    print("\n2. Schema (tables / views / functions the web app uses)")
    missing = 0
    for t in TABLES:
        status, body, _ = call("GET", f"/rest/v1/{t}?select=*&limit=1")
        if status == 200:
            ok(f"{t}")
        else:
            missing += 1
            bad(f"{t}: {status} {str(body)[:90]}", "Apply supabase/migrations 0100 → 0200 → 0300 in the Supabase SQL editor (in that order).")
    for fn, args in RPCS.items():
        status, body, _ = call("POST", f"/rest/v1/rpc/{fn}", args)
        if status in (200, 204):
            ok(f"rpc {fn}()")
        else:
            missing += 1
            bad(f"rpc {fn}(): {status} {str(body)[:90]}", "Apply migration 0200_search.sql (functions) and 0300 (grants).")
    if missing:
        print(f"\n{missing} schema object(s) missing — the app will show 'Database not ready' until the migrations are applied.")
        return 1

    print("\n3. Row Level Security (what anonymous visitors can read)")
    _, _, hdrs = call("GET", "/rest/v1/trademarks?select=id", headers={"Prefer": "count=exact", "Range": "0-0"})
    total = hdrs.get("Content-Range", "*/0").split("/")[-1]
    total_n = int(total) if total.isdigit() else 0
    if total_n > 0:
        ok(f"anon can read trademarks: {total_n} rows visible")
    else:
        bad("anon sees 0 trademarks", "Either the table is empty (run the Excel importer) or the RLS policy from 0300 is missing / is_published is false.")
    status, body, _ = call("POST", "/rest/v1/rpc/registry_stats", {})
    if status == 200 and isinstance(body, dict):
        ok(f"registry_stats: {json.dumps(body, ensure_ascii=False)}")
    status, body, _ = call("GET", "/rest/v1/import_jobs?select=id&limit=1")
    if status in (401, 403, 404) or (status == 200 and body == []):
        ok("import_jobs hidden from anon (admin-only) ")
    else:
        bad(f"import_jobs readable by anon (status {status})", "Re-apply 0300_rls_and_storage.sql.")
    status, body, _ = call("POST", "/rest/v1/trademarks", {"serial_number": "x", "official_gazette_number": "0"})
    if status in (401, 403):
        ok("anon cannot insert trademarks")
    else:
        bad(f"anon INSERT returned {status}", "Re-apply 0300_rls_and_storage.sql (write policies are admin-only).")

    print("\n4. Storage")
    status, body, _ = call("GET", "/storage/v1/bucket/trademark-images")
    if status == 200:
        pub = body.get("public") if isinstance(body, dict) else None
        (ok if pub else bad)("bucket trademark-images exists" + ("" if pub else " but is PRIVATE"), "Run the storage block of 0300 or set the bucket to public in Storage settings.") if not pub else ok("bucket trademark-images exists and is public")
    else:
        bad(f"bucket trademark-images: {status}", "Migration 0300 creates it when run in the Supabase SQL editor; or create a public bucket named trademark-images in Storage.")

    print()
    if problems:
        print(f"{len(problems)} problem(s) found.")
        return 1
    print("All checks passed — TMistan can run against this project.")
    return 0


def _jwt_payload(key: str) -> str:
    import base64

    try:
        part = key.split(".")[1]
        return base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)).decode()
    except Exception:  # noqa: BLE001
        return ""


if __name__ == "__main__":
    sys.exit(main())
