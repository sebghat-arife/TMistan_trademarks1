"""Operator CLI — unattended indexing from a machine that holds the service-role key.

    SUPABASE_URL=... SUPABASE_PUBLISHABLE_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
    python -m app.cli index --limit 200 [--retry-failed] [--all]

The service-role key is read from the environment only (never written to disk by this tool).
"""
from __future__ import annotations

import argparse
import json
import os
import sys

from . import indexer
from .supabase_client import Supabase


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="tmistan-vision")
    sub = ap.add_subparsers(dest="cmd", required=True)
    ix = sub.add_parser("index", help="index the next batch of stored trademark images")
    ix.add_argument("--limit", type=int, default=200)
    ix.add_argument("--retry-failed", action="store_true")
    ix.add_argument("--all", action="store_true", help="keep going until nothing is pending")
    st = sub.add_parser("status", help="print index counts")
    args = ap.parse_args(argv)
    token = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_ADMIN_TOKEN")
    if not token:
        print("SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ADMIN_TOKEN = an administrator's access token) is required", file=sys.stderr)
        return 2
    sb = Supabase()
    if args.cmd == "status":
        print(json.dumps(sb.rpc("admin_image_analysis_status", {"p_model": indexer.model_version()}, token), indent=1))
        return 0
    total = {"attempted": 0, "indexed": 0, "failed": 0}
    while True:
        rep = indexer.run_batch(sb, token, limit=args.limit, retry_failed=args.retry_failed)
        for k in total:
            total[k] += rep[k]
        print(json.dumps({k: rep[k] for k in ("attempted", "indexed", "failed", "ocr_with_text", "duration_ms")}))
        if not args.all or rep["attempted"] == 0:
            break
    print("total", json.dumps(total))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
