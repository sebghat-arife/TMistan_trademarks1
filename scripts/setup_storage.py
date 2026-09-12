#!/usr/bin/env python3
"""Create / verify the Supabase Storage buckets for TMistan (operator tool).

Run ONCE per project from a trusted machine — needs the SERVICE-ROLE key
(reads importers/.env or the environment). Idempotent: re-running only
reports.

    python3 scripts/setup_storage.py            # create if missing, then verify
    python3 scripts/setup_storage.py --check    # verify only (no changes)

Why a script and not SQL: on hosted Supabase the SQL editor role no longer
owns storage.objects (April 2025 change), so bucket/policy statements in a
migration fail with "must be owner of table objects". The Storage API is the
supported way. No storage.objects policy is created for anon/authenticated,
so the browser can only READ objects of the public bucket; every write goes
through the service role (importers).
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

BUCKETS = [
    {
        "id": "trademark-images",
        "name": "trademark-images",
        "public": True,
        "file_size_limit": 10 * 1024 * 1024,
        "allowed_mime_types": ["image/png", "image/jpeg", "image/webp", "image/gif", "image/tiff"],
    },
    {
        "id": "source-documents",
        "name": "source-documents",
        "public": False,
        "file_size_limit": 50 * 1024 * 1024,   # free-tier global max is 50 MB
    },
]


def load_env() -> tuple[str, str]:
    env_file = Path(__file__).resolve().parents[1] / "importers" / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    url = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""
    if not url or not key:
        sys.exit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (importers/.env or environment).")
    if key.startswith("sb_publishable_"):
        sys.exit("That is the publishable key; bucket administration needs the service-role (secret) key.")
    return url, key


def call(url: str, key: str, method: str, path: str, body: dict | None = None) -> tuple[int, object]:
    req = urllib.request.Request(
        f"{url}{path}", method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, raw


def main() -> int:
    check_only = "--check" in sys.argv
    url, key = load_env()
    status, existing = call(url, key, "GET", "/storage/v1/bucket")
    if status != 200:
        print(f"✗ cannot list buckets ({status}): {existing}")
        return 1
    by_id = {b["id"]: b for b in existing}  # type: ignore[union-attr]
    problems = 0
    for spec in BUCKETS:
        cur = by_id.get(spec["id"])
        if cur is None:
            if check_only:
                print(f"✗ bucket {spec['id']} missing (run without --check to create)")
                problems += 1
                continue
            status, body = call(url, key, "POST", "/storage/v1/bucket", spec)
            if status in (200, 201):
                print(f"✓ created bucket {spec['id']} (public={spec['public']})")
            else:
                print(f"✗ creating {spec['id']} failed ({status}): {body}")
                problems += 1
                continue
        else:
            if bool(cur.get("public")) != spec["public"]:
                if check_only:
                    print(f"✗ bucket {spec['id']} public={cur.get('public')} (expected {spec['public']})")
                    problems += 1
                else:
                    status, body = call(url, key, "PUT", f"/storage/v1/bucket/{spec['id']}", {"public": spec["public"]})
                    print(("✓ fixed" if status == 200 else f"✗ could not fix ({status}) {body}") + f" visibility of {spec['id']}")
                    problems += 0 if status == 200 else 1
            else:
                print(f"✓ bucket {spec['id']} exists (public={cur.get('public')}, limit={cur.get('file_size_limit')})")
    # Behavioural check of the public bucket: anonymous read works, anonymous write does not.
    status, _ = call(url, "", "GET", "/storage/v1/object/public/trademark-images/__does_not_exist__.png")
    print(("✓" if status in (400, 404) else "✗") + f" anonymous public read path answers ({status}; 404/400 = bucket reachable, object absent)")
    req = urllib.request.Request(f"{url}/storage/v1/object/trademark-images/__probe__.png", method="POST", data=b"x",
                                 headers={"Content-Type": "image/png"})
    try:
        urllib.request.urlopen(req, timeout=15)
        print("✗ anonymous upload SUCCEEDED — remove any permissive storage.objects policy!")
        problems += 1
        call(url, key, "DELETE", "/storage/v1/object/trademark-images/__probe__.png")
    except urllib.error.HTTPError as e:
        print(f"✓ anonymous upload rejected ({e.code})")
    print("\nStorage OK" if not problems else f"\n{problems} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
