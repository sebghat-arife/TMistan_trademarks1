"""Offline text indexer for TMistan "Search by Image" — runs on a PC or in a Codespace, $0.

    python -m tools.image_index check                      # tesseract + models + database reachable?
    python -m tools.image_index status                     # counts: with text / skipped / pending / failed
    python -m tools.image_index analyse path/to/image.png  # local test, nothing is written
    python -m tools.image_index index --limit 20           # small sample first …
    python -m tools.image_index index --all                # … then everything that is pending
    python -m tools.image_index index --retry-failed --limit 50
    python -m tools.image_index index --include-skipped --all   # re-analyse images that had no text

What it does, per pending image: download the public Storage object → the same
pre-processing and Tesseract passes the browser uses (eng + fas + pus,
tessdata_fast models copied from web/public/ocr/tessdata) → store ONLY the
recognised words through `admin_upsert_image_analysis` (one row per image and
model version; a re-run updates the row). Trademark rows, image rows and the
Storage objects are never modified. The run is resumable (the database decides
what is still pending), idempotent and safe to interrupt (Ctrl-C flushes what is
finished). Once the index is stored the PC can go offline — Supabase serves it.

Configuration (environment or the git-ignored files, first match wins):
    SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY      web/.env.local or web/.env (public values)
    authentication, one of
      --login EMAIL  (+ TMISTAN_ADMIN_PASSWORD or an interactive prompt)   ← recommended
      --service-key  (SUPABASE_SERVICE_ROLE_KEY from importers/.env; trusted machine only)
"""
from __future__ import annotations

import argparse
import getpass
import json
import os
import signal
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from . import ocr
from .preprocess import ImageError, load_image
from .supabase_client import RpcError, Supabase
from .textnorm import variants_for
from .version import IMAGE_ANALYSIS_MODEL

ROOT = Path(__file__).resolve().parents[2]
MAX_OBJECT_BYTES = 25 * 1024 * 1024
FLUSH_EVERY = 25            # rows per upsert call (≤ 200 accepted by the database)
MAX_FAILURES_SHOWN = 25


# ----------------------------------------------------------------------------- configuration
def load_dotenv(path: Path, keys: tuple[str, ...]) -> None:
    """Export selected KEY=VALUE lines from a dotenv file without overriding the environment."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        if k in keys and k not in os.environ:
            os.environ[k] = v.strip().strip('"').strip("'")


def configure(args: argparse.Namespace) -> Supabase:
    load_dotenv(ROOT / "web" / ".env.local", ("SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"))
    load_dotenv(ROOT / "web" / ".env", ("SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"))
    if args.service_key:
        load_dotenv(ROOT / "importers" / ".env", ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"))
    sb = Supabase()
    if not sb.configured:
        sys.exit("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required (web/.env.local or the environment).")
    if args.service_key:
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        if not key:
            sys.exit("--service-key: SUPABASE_SERVICE_ROLE_KEY is not set (importers/.env).")
        sb.bearer = key
    elif args.login:
        pw = os.environ.get("TMISTAN_ADMIN_PASSWORD") or getpass.getpass(f"Password for {args.login}: ")
        try:
            sb.sign_in(args.login, pw)
        except RpcError as e:
            sys.exit(f"Sign-in failed: {e}")
    elif os.environ.get("SUPABASE_ADMIN_TOKEN"):
        sb.bearer = os.environ["SUPABASE_ADMIN_TOKEN"]
    return sb


def need_auth(args: argparse.Namespace) -> None:
    if not (args.login or args.service_key or os.environ.get("SUPABASE_ADMIN_TOKEN")):
        sys.exit("Authentication required: --login <admin email> (recommended) or --service-key.")


def explain(e: RpcError) -> str:
    if e.missing_function:
        return "the database does not have the Search-by-Image functions yet — apply supabase/APPLY_1300.sql (migrations 1200 + 1300) in the Supabase SQL editor"
    if e.status in (401, 403) or e.code in ("42501", "P0001") and "admin" in str(e).lower():
        return f"not authorised ({e}) — sign in with an administrator account"
    return str(e)


# ----------------------------------------------------------------------------- analysis
def analyse_bytes(data: bytes) -> dict:
    """bytes → upsert item fields (without image_id). Mirrors web/src/lib/imageSearch/indexer.ts."""
    t0 = time.time()
    loaded = load_image(data, MAX_OBJECT_BYTES)
    r = ocr.recognise(loaded)
    warnings: list[str] = []
    if loaded.blank:
        warnings.append("blank")
    if not r.words and not loaded.blank:
        warnings.append("no_text")
    if r.uncertain and r.words:
        warnings.append("uncertain")
    duration_ms = int((time.time() - t0) * 1000)
    if not r.words:
        return {"status": "skipped", "warnings": warnings, "duration_ms": duration_ms, "engine": ocr.ENGINE,
                "_variants": [], "_ocr": r.to_dict(), "_image": {"width": loaded.width, "height": loaded.height, "blank": loaded.blank}}
    d = r.to_dict()
    return {
        "status": "indexed",
        "ocr_text": r.text[:2000],
        "ocr_confidence": round(r.confidence, 1),
        "ocr_words": d["words"],
        "ocr_scripts": r.scripts,
        "warnings": warnings,
        "duration_ms": duration_ms,
        "engine": ocr.ENGINE,
        "_variants": variants_for([w.normalized for w in r.words]),
        "_ocr": d,
        "_image": {"width": loaded.width, "height": loaded.height, "blank": loaded.blank},
    }


def strip_private(item: dict) -> dict:
    return {k: v for k, v in item.items() if not k.startswith("_")}


def analyse_stored(sb: Supabase, img: dict) -> dict:
    t0 = time.time()
    item: dict = {"image_id": img["id"]}
    try:
        data = sb.download(img.get("storage_bucket") or "trademark-images", img["storage_path"], MAX_OBJECT_BYTES)
        item.update(strip_private(analyse_bytes(data)))
    except ImageError as e:
        item.update({"status": "failed", "error": f"{e.code}: {e}"[:500], "duration_ms": int((time.time() - t0) * 1000), "engine": ocr.ENGINE})
    except Exception as e:  # network, decode, tesseract crash
        item.update({"status": "failed", "error": f"{type(e).__name__}: {str(e)[:200]}", "duration_ms": int((time.time() - t0) * 1000), "engine": ocr.ENGINE})
    return item


# ----------------------------------------------------------------------------- commands
def cmd_check(args: argparse.Namespace) -> int:
    ok, ver, langs = ocr.available()
    print(f"tesseract: {'found, version ' + ver if ok else 'NOT FOUND (install tesseract-ocr; see tools/image_index/README.md)'}")
    if ok:
        print(f"tessdata:  {ocr.tessdata_dir()}  languages: {', '.join(sorted(langs))}")
        missing = [l for l in ("eng", "fas", "pus") if l not in langs]
        if missing:
            print(f"  MISSING languages: {', '.join(missing)}")
            ok = False
    print(f"model:     {IMAGE_ANALYSIS_MODEL}")
    try:
        sb = configure(args)
    except SystemExit as e:
        print(f"database:  {e}")
        return 1
    print(f"database:  {sb.url}  (publishable key: {'yes' if sb.anon_key else 'no'}; bearer: {'admin' if sb.bearer else 'anonymous'})")
    try:
        st = sb.rpc("hybrid_image_search_status", {"p_model": IMAGE_ANALYSIS_MODEL})
        print(f"migrations 1200+1300: applied — indexed_images={st.get('indexed_images')} images_with_text={st.get('images_with_text')} images_skipped={st.get('images_skipped')}")
    except RpcError as e:
        print(f"migrations: {explain(e)}")
        ok = False
    if sb.bearer:
        try:
            st = sb.rpc("admin_image_analysis_status", {"p_model": IMAGE_ANALYSIS_MODEL})
            print(f"admin status: matched={st.get('matched_images')} with_text={st.get('with_text')} skipped={st.get('skipped')} pending={st.get('pending')} failed={st.get('failed')}")
        except RpcError as e:
            print(f"admin status: {explain(e)}")
            ok = False
    return 0 if ok else 1


def cmd_status(args: argparse.Namespace) -> int:
    need_auth(args)
    sb = configure(args)
    try:
        st = sb.rpc("admin_image_analysis_status", {"p_model": IMAGE_ANALYSIS_MODEL})
    except RpcError as e:
        sys.exit(f"status failed: {explain(e)}")
    if args.json:
        print(json.dumps(st, ensure_ascii=False, indent=1))
        return 0
    total = int(st.get("matched_images") or 0)
    done = int(st.get("with_text") or 0) + int(st.get("skipped") or 0)
    pct = (100.0 * done / total) if total else 0.0
    print(f"model            {st.get('model_version') or IMAGE_ANALYSIS_MODEL}")
    print(f"matched images   {total}")
    print(f"with text        {st.get('with_text')}")
    print(f"no readable text {st.get('skipped')}  (status 'skipped'; re-run with --include-skipped)")
    print(f"pending          {st.get('pending')}")
    print(f"failed           {st.get('failed')}")
    print(f"coverage         {done}/{total} ({pct:.1f} %)")
    if st.get("other_versions"):
        print(f"other versions   {st.get('other_versions')} rows (another model string; ignored by the search)")
    if st.get("last_indexed_at"):
        print(f"last analysed    {st.get('last_indexed_at')}")
    for f in (st.get("failures") or [])[:MAX_FAILURES_SHOWN]:
        print(f"  failed  {f.get('serial_number') or '-':<12} {f.get('storage_path')}  {f.get('error')}")
    return 0


def cmd_analyse(args: argparse.Namespace) -> int:
    ok, _, langs = ocr.available()
    if not ok:
        sys.exit("tesseract not found — see tools/image_index/README.md")
    rc = 0
    for p in args.files:
        path = Path(p)
        try:
            item = analyse_bytes(path.read_bytes())
        except ImageError as e:
            print(f"{path.name}: rejected ({e.code}: {e})")
            rc = 1
            continue
        o = item["_ocr"]
        words = " ".join(f"{w['text']}({w['confidence']:.0f})" for w in o["words"])
        print(f"{path.name}: status={item['status']} conf={o['confidence']} scripts={o['scripts']} uncertain={o['uncertain']} passes={o['passes']} {o['duration_ms']} ms")
        print(f"  words:    {words or '-'}")
        if item["_variants"]:
            print("  variants: " + ", ".join(f"{v['text']} (possible {v['kind']} of {v['from']})" for v in item["_variants"][:8]))
        if item.get("warnings"):
            print(f"  warnings: {', '.join(item['warnings'])}")
        if args.json:
            print(json.dumps(strip_private(item), ensure_ascii=False))
    return rc


def cmd_index(args: argparse.Namespace) -> int:
    need_auth(args)
    ok, ver, langs = ocr.available()
    if not ok:
        sys.exit("tesseract not found — see tools/image_index/README.md")
    missing = [l for l in ("eng", "fas", "pus") if l not in langs]
    if missing:
        sys.exit(f"tesseract languages missing: {', '.join(missing)} (tessdata dir: {ocr.tessdata_dir()})")
    sb = configure(args)
    limit = max(1, min(int(args.limit), 500))
    workers = max(1, min(int(args.workers), 8))
    stop = {"flag": False}

    def on_sigint(*_):
        if stop["flag"]:
            raise KeyboardInterrupt
        stop["flag"] = True
        print("\nstopping after the images already in progress … (press Ctrl-C again to abort without saving)", flush=True)

    signal.signal(signal.SIGINT, on_sigint)
    total = {"attempted": 0, "indexed": 0, "skipped": 0, "failed": 0, "rejected": 0}
    failures: list[dict] = []
    t_start = time.time()
    rounds = 0
    while not stop["flag"]:
        rounds += 1
        try:
            pending = sb.rpc("admin_image_analysis_pending", {
                "p_model": IMAGE_ANALYSIS_MODEL, "p_limit": limit,
                "p_retry_failed": bool(args.retry_failed), "p_include_skipped": bool(args.include_skipped),
            }) or []
        except RpcError as e:
            sys.exit(f"listing pending images failed: {explain(e)}")
        if not pending:
            if rounds == 1:
                print("nothing pending for this model version — the index is complete" + (" (use --retry-failed / --include-skipped to revisit rows)" if not (args.retry_failed or args.include_skipped) else ""))
            break
        print(f"round {rounds}: {len(pending)} image(s) to analyse with {workers} worker(s) (tesseract {ver}, model {IMAGE_ANALYSIS_MODEL})", flush=True)
        if args.dry_run:
            for img in pending[:10]:
                print(f"  would analyse {img.get('serial_number') or '-':<12} {img.get('storage_path')}")
            if len(pending) > 10:
                print(f"  … and {len(pending) - 10} more")
            return 0
        buffer: list[dict] = []
        done = 0
        t_round = time.time()

        def flush() -> None:
            nonlocal buffer
            if not buffer:
                return
            chunk, buffer = buffer, []
            try:
                res = sb.rpc("admin_upsert_image_analysis", {"p_model": IMAGE_ANALYSIS_MODEL, "p_items": chunk}) or {}
            except RpcError as e:
                sys.exit(f"storing results failed: {explain(e)}  ({len(chunk)} analysed images not saved; re-run to redo them)")
            by_id = {c["image_id"]: c for c in chunk}
            for r in res.get("results", []):
                st = r.get("status")
                total["attempted"] += 1
                if st == "indexed":
                    total["indexed"] += 1
                elif st == "skipped":
                    total["skipped"] += 1
                else:
                    total["failed"] += 1
                    c = by_id.get(r.get("image_id"), {})
                    if c.get("status") != "failed":
                        total["rejected"] += 1
                    if len(failures) < MAX_FAILURES_SHOWN:
                        failures.append({"image_id": r.get("image_id"), "error": r.get("error") or c.get("error") or "rejected"})

        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(analyse_stored, sb, img): img for img in pending}
            for fut in as_completed(futures):
                img = futures[fut]
                item = fut.result()
                buffer.append(item)
                done += 1
                tag = item["status"] + ("" if item["status"] != "failed" else f" ({item.get('error')})")
                txt = (item.get("ocr_text") or "")[:40]
                elapsed = time.time() - t_round
                eta = (elapsed / done) * (len(pending) - done)
                print(f"  [{done:>4}/{len(pending)}] {img.get('serial_number') or '-':<12} {tag:<10} {txt!r:<44} {item.get('duration_ms', 0):>5} ms  eta {eta / 60:4.1f} min", flush=True)
                if len(buffer) >= FLUSH_EVERY:
                    flush()
                if stop["flag"]:
                    for f in futures:
                        f.cancel()
                    break
        flush()
        print(f"round {rounds} done in {time.time() - t_round:.0f} s — totals: {json.dumps(total)}", flush=True)
        if not args.all or stop["flag"]:
            break
    secs = time.time() - t_start
    print(f"\nfinished in {secs:.0f} s: {total['indexed']} with text · {total['skipped']} without readable text · {total['failed']} failed (of {total['attempted']})")
    if total["rejected"]:
        print(f"  {total['rejected']} row(s) were rejected by the database — see errors below")
    for f in failures:
        print(f"  failed  {f['image_id']}  {f['error']}")
    if stop["flag"]:
        print("stopped by the operator; run the same command again to continue")
    try:
        st = sb.rpc("admin_image_analysis_status", {"p_model": IMAGE_ANALYSIS_MODEL})
        print(f"index now: with text {st.get('with_text')} · skipped {st.get('skipped')} · pending {st.get('pending')} · failed {st.get('failed')} of {st.get('matched_images')} matched images")
    except RpcError:
        pass
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m tools.image_index", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--login", metavar="EMAIL", help="administrator e-mail (password from TMISTAN_ADMIN_PASSWORD or a prompt)")
    ap.add_argument("--service-key", action="store_true", help="use SUPABASE_SERVICE_ROLE_KEY from importers/.env (trusted machine only)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check", help="verify tesseract, language models and database access")
    st = sub.add_parser("status", help="print the index status for the current model version")
    st.add_argument("--json", action="store_true")
    an = sub.add_parser("analyse", help="recognise text in local image files (nothing is written)")
    an.add_argument("files", nargs="+")
    an.add_argument("--json", action="store_true")
    ix = sub.add_parser("index", help="analyse pending stored images and save the words to Supabase")
    ix.add_argument("--limit", type=int, default=100, help="images per round (≤ 500); start with a small sample, e.g. 20")
    ix.add_argument("--all", action="store_true", help="keep going until nothing is pending")
    ix.add_argument("--retry-failed", action="store_true", help="also take images whose last attempt failed")
    ix.add_argument("--include-skipped", action="store_true", help="also re-analyse images recorded as 'no readable text'")
    ix.add_argument("--workers", type=int, default=max(1, min(4, (os.cpu_count() or 2))), help="parallel images (default: CPU count, ≤ 4)")
    ix.add_argument("--dry-run", action="store_true", help="list what would be analysed, write nothing")
    args = ap.parse_args(argv)
    try:
        return {"check": cmd_check, "status": cmd_status, "analyse": cmd_analyse, "index": cmd_index}[args.cmd](args)
    except KeyboardInterrupt:
        print("\naborted", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
