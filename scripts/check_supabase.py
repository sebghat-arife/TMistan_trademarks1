#!/usr/bin/env python3
"""Verify that a Supabase project is ready for TMistan — using ONLY the public key.

    SUPABASE_URL=https://<ref>.supabase.co SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
        python3 scripts/check_supabase.py [--expect-rows 732]

Checks, in the order a browser would hit them:
  1. the REST endpoint answers with the key
  2. every table / view / RPC the web app calls exists (= migrations applied)
  3. real data: row count, per-gazette counts, search / detail / filters / stats
  4. Row Level Security: anonymous READ works, anonymous WRITE is refused,
     admin-only tables are hidden
  5. Storage: the public bucket answers on the public object path and refuses
     anonymous uploads

Exit code 0 = ready, 1 = something to fix (each failure prints the fix).
Standard library only. Reads importers/.env or web/.env.local for convenience
if the variables are not set (publishable key only — a secret key is refused).
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

TABLES = ["trademarks", "gazettes", "trademark_images", "gazette_summaries", "trademark_primary_images"]
RPCS = {
    "registry_stats": {},
    "recent_trademarks": {"p_limit": 1},
    "trademarks_by_class": {},
    "trademark_filter_options": {},
    "search_trademarks": {"p_limit": 1},
    "is_admin": {},
}
ADMIN_ONLY_TABLES = ["import_jobs", "import_job_items", "audit_logs", "user_roles"]
# Migration 0400 — Admin Import Center. SECURITY DEFINER functions; anon must be refused (42501), not "not found".
# Named arguments matter: PostgREST resolves overloads by parameter names, so an empty body would
# report "function without parameters not found" even when the function exists.
IMPORT_RPCS = {
    "admin_assert": {},
    "admin_create_import_job": {"p_job_type": "excel", "p_filename": "probe.xlsx", "p_total_rows": 0, "p_summary": {}},
    "admin_import_trademark_rows": {"p_job_id": "00000000-0000-0000-0000-000000000000", "p_rows": []},
    "admin_resolve_serials": {"p_serials": ["0000-000"]},
    "admin_register_images": {"p_job_id": "00000000-0000-0000-0000-000000000000", "p_items": []},
    "admin_trademarks_without_images": {"p_limit": 1, "p_offset": 0},
}


def _load_dotenv() -> None:
    root = Path(__file__).resolve().parents[1]
    for f in (root / "web" / ".env.local", root / "importers" / ".env"):
        if f.exists():
            for line in f.read_text().splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _jwt_payload(key: str) -> str:
    try:
        part = key.split(".")[1]
        return base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)).decode()
    except Exception:  # noqa: BLE001
        return ""


class Client:
    def __init__(self, url: str, key: str) -> None:
        self.url, self.key = url, key

    def call(self, method: str, path: str, body: dict | None = None, headers: dict | None = None, auth: bool = True):
        h = {"Content-Type": "application/json", **(headers or {})}
        if auth:
            h.update({"apikey": self.key, "Authorization": f"Bearer {self.key}"})
        req = urllib.request.Request(f"{self.url}{path}", method=method,
                                     data=json.dumps(body).encode() if body is not None else None, headers=h)
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
        except urllib.error.URLError as e:
            return 0, str(e.reason), {}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--expect-rows", type=int, default=None, help="fail unless exactly this many trademarks are visible")
    args = ap.parse_args()
    _load_dotenv()
    url = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    key = os.environ.get("SUPABASE_PUBLISHABLE_KEY") or os.environ.get("SUPABASE_ANON_KEY") or ""

    problems: list[str] = []

    def ok(m: str) -> None:
        print(f"  ✓ {m}")

    def bad(m: str, fix: str) -> None:
        print(f"  ✗ {m}\n      → {fix}")
        problems.append(m)

    print(f"TMistan Supabase check — {url or '(SUPABASE_URL not set)'}")
    if not url.startswith("http") or not key:
        print("  ✗ SUPABASE_URL (https://<ref>.supabase.co) and SUPABASE_PUBLISHABLE_KEY must be set.")
        return 1
    if key.startswith("sb_secret_") or '"service_role"' in _jwt_payload(key):
        print("  ✗ That is a SECRET / service-role key. Use the publishable (anon) key here — and never in the web app.")
        return 1
    c = Client(url, key)

    print("\n1. Connectivity")
    status, body, _ = c.call("GET", "/rest/v1/trademarks?select=id&limit=1")
    if status == 200:
        ok("REST endpoint reachable, publishable key accepted")
    else:
        bad(f"REST returned {status}: {str(body)[:120]}", "Check the project URL and that the key is the publishable/anon key of THIS project.")
        return 1

    print("\n2. Schema (objects the web app uses)")
    missing = 0
    for t in TABLES:
        status, body, _ = c.call("GET", f"/rest/v1/{t}?select=*&limit=1")
        if status == 200:
            ok(t)
        else:
            missing += 1
            bad(f"{t}: {status} {str(body)[:90]}", "Run supabase/APPLY_ALL.sql in the Supabase SQL editor.")
    for fn, a in RPCS.items():
        status, body, _ = c.call("POST", f"/rest/v1/rpc/{fn}", a)
        if status in (200, 204):
            ok(f"rpc {fn}()")
        else:
            missing += 1
            bad(f"rpc {fn}(): {status} {str(body)[:90]}", "Run supabase/APPLY_ALL.sql in the Supabase SQL editor.")
    if missing:
        print(f"\n{missing} schema object(s) missing — the app shows 'Database not ready' until the migrations are applied.")
        return 1
    print("\n2b. Admin Import Center (migration 0400)")
    # The OpenAPI document is not always exposed to anon, so probe the functions directly:
    # PGRST202 (404) = function missing → migration not applied; 401/403/42501 = present and refusing anon.
    import_missing = []
    for fn, args in IMPORT_RPCS.items():
        status, body, _ = c.call("POST", f"/rest/v1/rpc/{fn}", args)
        code = body.get("code") if isinstance(body, dict) else None
        if status == 404 and code == "PGRST202":
            import_missing.append(fn)
        elif status in (401, 403) or code == "42501":
            ok(f"rpc {fn}() present, anonymous call refused ({status})")
        else:
            bad(f"rpc {fn}() for anon → {status} {str(body)[:70]}", "Admin functions must refuse non-admins (APPLY_0400.sql grants execute to 'authenticated' only).")
    if import_missing:
        bad(f"missing admin import functions: {', '.join(import_missing)}",
            "Run supabase/APPLY_0400.sql in the Supabase SQL editor — the Import Center shows 'not available' until then.")

    print("\n3. Real data through the public key")
    _, _, hdrs = c.call("GET", "/rest/v1/trademarks?select=id", headers={"Prefer": "count=exact", "Range": "0-0"})
    total = hdrs.get("Content-Range", "*/0").split("/")[-1]
    total_n = int(total) if total.isdigit() else 0
    if total_n > 0 and (args.expect_rows is None or total_n == args.expect_rows):
        ok(f"{total_n} trademarks visible" + (f" (expected {args.expect_rows})" if args.expect_rows else ""))
    elif total_n > 0:
        bad(f"{total_n} trademarks visible, expected {args.expect_rows}", "Check the importer run / duplicates (unique key official_gazette_number + serial_number).")
    else:
        bad("anon sees 0 trademarks", "Table empty (run the Excel importer) or RLS policy missing / is_published = false.")
    status, gz, _ = c.call("GET", "/rest/v1/gazette_summaries?select=gazette_number,trademark_count&order=sort_key")
    if status == 200 and gz:
        ok("gazettes: " + ", ".join(f"{g['gazette_number']}={g['trademark_count']}" for g in gz))
        if sum(g["trademark_count"] for g in gz) != total_n:
            bad("gazette totals do not add up to the trademark count", "Some rows have an official_gazette_number without a gazettes row — re-run APPLY_ALL.sql (back-fill is idempotent).")
    else:
        bad(f"gazette_summaries empty ({status})", "Re-run APPLY_ALL.sql (gazettes back-fill).")
    status, st, _ = c.call("POST", "/rest/v1/rpc/registry_stats", {})
    if status == 200 and isinstance(st, dict) and st.get("trademarks") == total_n:
        ok(f"registry_stats: trademarks={st['trademarks']} applicants={st['applicants']} gazettes={st['gazettes']} images={st['images']}")
    else:
        bad(f"registry_stats mismatch: {st}", "Stats RPC and table disagree — re-run APPLY_ALL.sql.")
    status, rows, _ = c.call("POST", "/rest/v1/rpc/search_trademarks", {"p_query": "caravell", "p_limit": 3})
    if status == 200 and rows:
        ok(f"search 'caravell' → {rows[0]['mark_name']} ({rows[0]['serial_number']}), total_count={rows[0]['total_count']}")
    else:
        bad(f"search returned nothing ({status}: {str(rows)[:80]})", "Search RPC broken or table empty.")
    for label, a in [("class 30", {"p_classes": [30], "p_limit": 1}), ("gazette 1045", {"p_gazette": "1045", "p_limit": 1}),
                     ("applicant 'khwaja'", {"p_applicant": "khwaja", "p_limit": 1}), ("goods 'rice'", {"p_goods": "rice", "p_limit": 1}),
                     ("serial '1042-00'", {"p_serial": "1042-00", "p_limit": 1}), ("page 2 newest", {"p_sort": "newest", "p_limit": 20, "p_offset": 20})]:
        status, rows, _ = c.call("POST", "/rest/v1/rpc/search_trademarks", a)
        if status == 200 and rows:
            ok(f"filter {label} → {rows[0]['total_count']} match(es)")
        else:
            bad(f"filter {label} → {status} {str(rows)[:60]}", "Search RPC / generated columns problem — re-run APPLY_ALL.sql.")
    status, det, _ = c.call("GET", "/rest/v1/trademarks?select=serial_number,mark_name,official_gazette_number,class_numbers&serial_number=eq.1045-001")
    if status == 200 and det:
        ok(f"detail 1045-001 → {det[0]['mark_name']} (gazette {det[0]['official_gazette_number']}, classes {det[0]['class_numbers']})")
    else:
        bad("detail lookup by serial failed", "Check RLS select policy on trademarks.")
    status, rec, _ = c.call("POST", "/rest/v1/rpc/recent_trademarks", {"p_limit": 3})
    if status == 200 and rec:
        ok("recent: " + ", ".join(r["serial_number"] for r in rec))
    status, byc, _ = c.call("POST", "/rest/v1/rpc/trademarks_by_class", {})
    if status == 200 and byc:
        ok(f"by class: {len(byc)} classes, top = class {max(byc, key=lambda x: x['count'])['class']}")

    print("\n4. Row Level Security (anonymous role)")
    for t in ADMIN_ONLY_TABLES:
        status, body, _ = c.call("GET", f"/rest/v1/{t}?select=*&limit=1")
        if status in (401, 403, 404) or (status == 200 and body == []):
            ok(f"{t}: hidden from anon ({status})")
        else:
            bad(f"{t}: readable by anon ({status})", "Re-run APPLY_ALL.sql (0300 revokes/grants).")
    status, body, _ = c.call("POST", "/rest/v1/trademarks", {"serial_number": "PROBE-000", "official_gazette_number": "0"})
    if status in (401, 403):
        ok(f"INSERT trademarks refused ({status})")
    else:
        bad(f"INSERT trademarks returned {status}", "Re-run APPLY_ALL.sql; remove any permissive policy in Dashboard → Authentication → Policies.")
        c.call("DELETE", "/rest/v1/trademarks?serial_number=eq.PROBE-000")
    status, body, _ = c.call("PATCH", "/rest/v1/trademarks?serial_number=eq.1011-001", {"review_note": "probe"}, headers={"Prefer": "return=representation"})
    if status in (401, 403) or (status == 200 and body == []) or status == 204:
        ok(f"UPDATE trademarks refused / no rows affected ({status})")
    else:
        bad(f"UPDATE trademarks returned {status}: {str(body)[:60]}", "Re-run APPLY_ALL.sql.")
    status, body, _ = c.call("DELETE", "/rest/v1/trademarks?serial_number=eq.1011-001", headers={"Prefer": "return=representation"})
    if status in (401, 403) or (status == 200 and body == []) or status == 204:
        ok(f"DELETE trademarks refused / no rows affected ({status})")
    else:
        bad(f"DELETE trademarks returned {status}", "Re-run APPLY_ALL.sql.")
    status, body, _ = c.call("POST", "/rest/v1/user_roles", {"user_id": "00000000-0000-4000-8000-000000000000", "role": "admin"})
    if status in (401, 403, 404):
        ok(f"INSERT user_roles (self-promotion) refused ({status})")
    else:
        bad(f"INSERT user_roles returned {status}", "Re-run APPLY_ALL.sql.")
    status, body, _ = c.call("POST", "/rest/v1/import_jobs", {"job_type": "excel"})
    if status in (401, 403, 404):
        ok(f"INSERT import_jobs refused ({status})")
    else:
        bad(f"INSERT import_jobs returned {status}", "Re-run APPLY_ALL.sql.")
    status, body, _ = c.call("POST", "/rest/v1/rpc/is_admin", {})
    if status == 200 and body is False:
        ok("is_admin() is false for anonymous")
    else:
        bad(f"is_admin() for anon → {status} {body}", "Function missing or grants wrong.")

    print("\n5. Storage")
    status, body, _ = c.call("GET", "/storage/v1/object/public/trademark-images/__does_not_exist__.png", auth=False)
    txt = json.dumps(body) if not isinstance(body, str) else body
    if status in (400, 404) and ("not_found" in txt or "NoSuchKey" in txt or "Object not found" in txt):
        ok("bucket trademark-images reachable on the public path (object absent → not_found)")
    elif status in (400, 404) and "Bucket not found" in txt:
        bad("bucket trademark-images does not exist", "python3 scripts/setup_storage.py (service-role key, operator machine).")
    else:
        bad(f"public object path answered {status}: {txt[:80]}", "Check Storage → trademark-images is PUBLIC.")
    status, body, _ = c.call("POST", "/storage/v1/object/trademark-images/__probe__.png", headers={"Content-Type": "image/png"})
    if status in (400, 401, 403):
        ok(f"anonymous upload refused ({status})")
    else:
        bad(f"anonymous upload returned {status}", "Remove permissive storage policies (Storage → Policies).")

    print()
    if problems:
        print(f"{len(problems)} problem(s) found.")
        return 1
    print("All checks passed — TMistan can run against this project.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
