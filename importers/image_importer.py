#!/usr/bin/env python3
"""
image_importer.py — deterministic, idempotent trademark image ingestion.

    scan folders → identify gazette → identify serial → find trademark in
    Supabase → upload to Storage → create trademark_images row → verify → log

USAGE
    # 1. Always start with a dry run. Nothing is uploaded or written.
    python image_importer.py --root /path/to/images --dry-run

    # 2. Limit to one gazette while validating the folder convention.
    python image_importer.py --root /path/to/images --gazette 1011 --dry-run

    # 3. Real run (uploads + DB rows + import_jobs record).
    python image_importer.py --root /path/to/images

    # Local dev stack (no Supabase Storage): write files to a folder that a
    # static server exposes instead of uploading.
    python image_importer.py --root ../local-storage/incoming \
        --local-storage-dir ../local-storage/trademark-images

MATCHING RULES  (§7 of the platform strategy)
    An image is attached ONLY when gazette + serial can be read
    deterministically from its path:

        <root>/<gazette>/<gazette>-<serial>.<ext>      e.g. 1011/1011-002.png
        <root>/<gazette>/<serial-without-prefix>.<ext> e.g. 1011/002.png
        <root>/<gazette>-<serial>.<ext>                e.g. 1011-002.png (flat)

    Optional suffixes select the image type:   1011-002_logo.png,
    1011-002_print.png / _mark_print, 1011-002_crop.png / _source_crop.
    Anything else with the same serial ("1011-002 (2).png", "1011-002a.png")
    is reported as AMBIGUOUS and NOT attached.

    A file whose serial does not exist in `trademarks` is reported as
    UNMATCHED. In a real run an `unmatched` trademark_images row is created
    (trademark_id NULL) so it appears in the admin review queue — the file is
    uploaded under  _unmatched/<gazette>/<filename>  so nothing is lost.

    The importer never matches on row order, applicant name, OCR, or fuzzy
    filenames.

IDEMPOTENCY
    • Storage path is deterministic:  <gazette>/<serial>[_<type>].<ext>
    • (storage_bucket, storage_path) is UNIQUE in trademark_images
    • (trademark_id, image_type, content_hash) is UNIQUE
    → Running the importer five times yields exactly one row per image.
      If the bytes changed (new scan), the row is updated and the object
      re-uploaded ("updated"); identical bytes are "skipped".

ENVIRONMENT (importers/.env or shell)
    SUPABASE_URL=https://xxxx.supabase.co
    SUPABASE_SERVICE_ROLE_KEY=...      # trusted machine ONLY — never the browser
    SUPABASE_BUCKET=trademark-images   # optional
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import io
import json
import logging
import os
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Optional

import httpx

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    Image = None  # type: ignore

LOG = logging.getLogger("image_importer")

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".tif", ".tiff", ".bmp"}
IGNORED_FILES = {"thumbs.db", ".ds_store", "desktop.ini"}
TYPE_SUFFIXES = {
    "logo": "logo",
    "print": "mark_print",
    "mark_print": "mark_print",
    "markprint": "mark_print",
    "crop": "source_crop",
    "source_crop": "source_crop",
    "sourcecrop": "source_crop",
}
THUMB_MAX = 320  # px, longest edge

# <gazette>-<serial>[_type]   where gazette is digits, serial is digits (leading zeros preserved)
FULL_RE = re.compile(r"^(?P<gazette>\d{2,6})[-_](?P<serial>\d{1,5})(?:[_-](?P<type>[a-z_]+))?$", re.IGNORECASE)
SHORT_RE = re.compile(r"^(?P<serial>\d{1,5})(?:[_-](?P<type>[a-z_]+))?$", re.IGNORECASE)
GAZ_DIR_RE = re.compile(r"^(?:gazette[_ -]?)?(?P<gazette>\d{2,6})$", re.IGNORECASE)


# --------------------------------------------------------------------------- #
# Data classes
# --------------------------------------------------------------------------- #
@dataclass
class Candidate:
    path: Path
    gazette: Optional[str]
    serial: Optional[str]           # full serial as stored in DB, e.g. "1011-002"
    image_type: str = "logo"
    problem: Optional[str] = None   # None | 'unparseable' | 'ambiguous' | 'bad_type'
    note: str = ""


@dataclass
class Outcome:
    status: str                     # inserted | updated | skipped | failed | unmatched | ambiguous
    candidate: Candidate
    message: str = ""
    storage_path: Optional[str] = None
    trademark_id: Optional[str] = None


@dataclass
class Report:
    gazettes: dict[str, Counter] = field(default_factory=lambda: defaultdict(Counter))
    outcomes: list[Outcome] = field(default_factory=list)

    def add(self, o: Outcome) -> None:
        self.outcomes.append(o)
        self.gazettes[o.candidate.gazette or "?"][o.status] += 1

    @property
    def totals(self) -> Counter:
        c: Counter = Counter()
        for g in self.gazettes.values():
            c.update(g)
        return c


# --------------------------------------------------------------------------- #
# Supabase REST/Storage client (service role, PostgREST + Storage API)
# --------------------------------------------------------------------------- #
class Supabase:
    def __init__(self, url: str, key: str, bucket: str, local_dir: Optional[Path] = None, timeout: float = 60.0):
        self.url = url.rstrip("/")
        self.key = key
        self.bucket = bucket
        self.local_dir = local_dir
        self.http = httpx.Client(
            timeout=timeout,
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
        )
        # Local PostgREST has no /rest/v1 prefix; Supabase does.
        self.rest = f"{self.url}/rest/v1" if self._is_supabase_host() else self.url

    def _is_supabase_host(self) -> bool:
        return "supabase" in self.url or self.url.endswith("/rest") or os.environ.get("SUPABASE_REST_PREFIX") == "1"

    # ----- PostgREST helpers -------------------------------------------------
    def select(self, table: str, params: dict[str, str]) -> list[dict[str, Any]]:
        r = self.http.get(f"{self.rest}/{table}", params=params)
        r.raise_for_status()
        return r.json()

    def insert(self, table: str, rows: list[dict[str, Any]], upsert_on: Optional[str] = None) -> list[dict[str, Any]]:
        headers = {"Prefer": "return=representation" + (",resolution=merge-duplicates" if upsert_on else "")}
        params = {"on_conflict": upsert_on} if upsert_on else None
        r = self.http.post(f"{self.rest}/{table}", json=rows, headers=headers, params=params)
        if r.status_code >= 400:
            raise RuntimeError(f"{table} insert failed {r.status_code}: {r.text[:300]}")
        return r.json()

    def update(self, table: str, match: dict[str, str], patch: dict[str, Any]) -> list[dict[str, Any]]:
        r = self.http.patch(f"{self.rest}/{table}", params=match, json=patch, headers={"Prefer": "return=representation"})
        if r.status_code >= 400:
            raise RuntimeError(f"{table} update failed {r.status_code}: {r.text[:300]}")
        return r.json()

    # ----- Storage -----------------------------------------------------------
    def upload(self, path: str, data: bytes, content_type: str) -> None:
        if self.local_dir is not None:
            dest = self.local_dir / self.bucket / path
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
            return
        r = self.http.post(
            f"{self.url}/storage/v1/object/{self.bucket}/{path}",
            content=data,
            headers={"Content-Type": content_type, "x-upsert": "true", "cache-control": "public, max-age=31536000, immutable"},
        )
        if r.status_code >= 400:
            raise RuntimeError(f"storage upload failed {r.status_code}: {r.text[:300]}")

    def object_exists(self, path: str) -> bool:
        if self.local_dir is not None:
            return (self.local_dir / self.bucket / path).exists()
        r = self.http.head(f"{self.url}/storage/v1/object/public/{self.bucket}/{path}")
        return r.status_code == 200


# --------------------------------------------------------------------------- #
# Discovery / parsing
# --------------------------------------------------------------------------- #
def iter_image_files(root: Path) -> Iterable[Path]:
    for p in sorted(root.rglob("*")):
        if not p.is_file():
            continue
        if p.name.lower() in IGNORED_FILES or p.name.startswith("."):
            continue
        if p.suffix.lower() in IMAGE_EXTS:
            yield p


def gazette_from_dirs(path: Path, root: Path) -> Optional[str]:
    """Nearest ancestor directory (below root) that looks like a gazette number."""
    for parent in path.relative_to(root).parents:
        if parent.name == "":
            break
        m = GAZ_DIR_RE.match(parent.name)
        if m:
            return m.group("gazette")
    return None


def parse_candidate(path: Path, root: Path, serial_width: int) -> Candidate:
    stem = path.stem.strip()
    dir_gazette = gazette_from_dirs(path, root)

    m = FULL_RE.match(stem)
    if m:
        gazette = m.group("gazette")
        if dir_gazette and dir_gazette != gazette:
            return Candidate(path, dir_gazette, None, problem="ambiguous",
                             note=f"folder says gazette {dir_gazette} but filename says {gazette}")
        serial = f"{gazette}-{int(m.group('serial')):0{serial_width}d}"
        return _with_type(Candidate(path, gazette, serial), m.group("type"))

    m = SHORT_RE.match(stem)
    if m and dir_gazette:
        serial = f"{dir_gazette}-{int(m.group('serial')):0{serial_width}d}"
        return _with_type(Candidate(path, dir_gazette, serial), m.group("type"))

    # Looks like a serial but with extra junk: "1011-002 (2)", "1011-002a", "copy of 1011-002"
    loose = re.search(r"(\d{2,6})[-_](\d{1,5})", stem)
    if loose:
        gz = loose.group(1)
        serial = f"{gz}-{int(loose.group(2)):0{serial_width}d}"
        return Candidate(path, dir_gazette or gz, serial, problem="ambiguous",
                         note=f"filename '{path.name}' contains serial {serial} but does not follow the convention")

    return Candidate(path, dir_gazette, None, problem="unparseable", note=f"cannot derive gazette/serial from '{path.name}'")


def _with_type(c: Candidate, raw_type: Optional[str]) -> Candidate:
    if not raw_type:
        return c
    t = TYPE_SUFFIXES.get(raw_type.lower())
    if t is None:
        c.problem = "bad_type"
        c.note = f"unknown image type suffix '{raw_type}'"
        return c
    c.image_type = t
    return c


# --------------------------------------------------------------------------- #
# Image processing
# --------------------------------------------------------------------------- #
def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def content_type_for(path: Path) -> str:
    return {
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
        ".gif": "image/gif", ".tif": "image/tiff", ".tiff": "image/tiff", ".bmp": "image/bmp",
    }.get(path.suffix.lower(), "application/octet-stream")


def probe_and_thumb(data: bytes) -> tuple[Optional[int], Optional[int], Optional[bytes]]:
    """Return (width, height, webp thumbnail bytes) — thumbnail None if PIL missing."""
    if Image is None:
        return None, None, None
    try:
        with Image.open(io.BytesIO(data)) as im:
            w, h = im.size
            im = im.convert("RGBA") if im.mode in ("P", "LA", "RGBA") else im.convert("RGB")
            im.thumbnail((THUMB_MAX, THUMB_MAX), Image.LANCZOS)
            buf = io.BytesIO()
            im.save(buf, "WEBP", quality=82, method=6)
            return w, h, buf.getvalue()
    except Exception as e:  # corrupt image
        LOG.warning("cannot decode image: %s", e)
        return None, None, None


# --------------------------------------------------------------------------- #
# Core
# --------------------------------------------------------------------------- #
class Importer:
    def __init__(self, sb: Supabase, root: Path, dry_run: bool, serial_width: int, only_gazette: Optional[str]):
        self.sb = sb
        self.root = root
        self.dry_run = dry_run
        self.serial_width = serial_width
        self.only_gazette = only_gazette
        self.report = Report()
        self.job_id: Optional[str] = None

    # ---- lookups -------------------------------------------------------------
    def load_trademarks(self, gazettes: set[str]) -> dict[tuple[str, str], str]:
        """(gazette, serial) → trademark id, for the gazettes we are about to process."""
        out: dict[tuple[str, str], str] = {}
        for g in sorted(gazettes):
            rows = self.sb.select("trademarks", {
                "select": "id,serial_number,official_gazette_number",
                "official_gazette_number": f"eq.{g}",
                "limit": "10000",
            })
            for r in rows:
                out[(r["official_gazette_number"], r["serial_number"])] = r["id"]
        return out

    def load_existing_images(self, gazettes: set[str]) -> dict[str, dict[str, Any]]:
        out: dict[str, dict[str, Any]] = {}
        for g in sorted(gazettes):
            rows = self.sb.select("trademark_images", {
                "select": "id,storage_path,content_hash,trademark_id,status,image_type",
                "gazette_number": f"eq.{g}",
                "limit": "10000",
            })
            for r in rows:
                out[r["storage_path"]] = r
        return out

    # ---- job bookkeeping ---------------------------------------------------
    def open_job(self, n_files: int) -> None:
        if self.dry_run:
            return
        row = self.sb.insert("import_jobs", [{
            "job_type": "images",
            "source_path": str(self.root),
            "gazette_number": self.only_gazette,
            "dry_run": False,
            "status": "processing",
            "started_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "total_rows": n_files,
        }])[0]
        self.job_id = row["id"]

    def close_job(self, error: Optional[str] = None) -> None:
        if self.dry_run or not self.job_id:
            return
        t = self.report.totals
        failed = t["failed"]
        warn = t["unmatched"] + t["ambiguous"]
        status = "failed" if error else ("completed_with_warnings" if (failed or warn) else "completed")
        self.sb.update("import_jobs", {"id": f"eq.{self.job_id}"}, {
            "status": status,
            "completed_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "inserted_rows": t["inserted"],
            "updated_rows": t["updated"],
            "skipped_rows": t["skipped"],
            "failed_rows": failed + warn,
            "error_message": error,
            "summary": {g: dict(c) for g, c in self.report.gazettes.items()},
        })
        items = [{
            "job_id": self.job_id,
            "item_ref": str(o.candidate.path.relative_to(self.root)),
            "status": o.status,
            "message": o.message or None,
            "payload": {"gazette": o.candidate.gazette, "serial": o.candidate.serial, "storage_path": o.storage_path, "trademark_id": o.trademark_id},
        } for o in self.report.outcomes if o.status != "skipped"]
        for i in range(0, len(items), 500):
            self.sb.insert("import_job_items", items[i:i + 500])

    # ---- main --------------------------------------------------------------
    def run(self) -> Report:
        files = list(iter_image_files(self.root))
        candidates = [parse_candidate(p, self.root, self.serial_width) for p in files]
        if self.only_gazette:
            candidates = [c for c in candidates if c.gazette == self.only_gazette]
        LOG.info("Found %d image files under %s%s", len(candidates), self.root, f" (gazette {self.only_gazette})" if self.only_gazette else "")

        # Detect duplicates: two conventional files mapping to the same (serial, type)
        by_key: dict[tuple[str, str], list[Candidate]] = defaultdict(list)
        for c in candidates:
            if c.problem is None and c.serial:
                by_key[(c.serial, c.image_type)].append(c)
        for key, group in by_key.items():
            if len(group) > 1:
                for c in group:
                    c.problem = "ambiguous"
                    c.note = f"{len(group)} files map to {key[0]} ({key[1]}): " + ", ".join(x.path.name for x in group)

        gazettes = {c.gazette for c in candidates if c.gazette}
        trademarks = self.load_trademarks(gazettes)
        existing = self.load_existing_images(gazettes)
        LOG.info("Loaded %d trademarks and %d existing image rows for %d gazette(s)", len(trademarks), len(existing), len(gazettes))

        self.open_job(len(candidates))
        try:
            for c in candidates:
                self.report.add(self.process(c, trademarks, existing))
        except Exception as e:  # abort cleanly, leave a failed job row
            LOG.exception("fatal error")
            self.close_job(error=str(e))
            raise
        self.close_job()
        return self.report

    def process(self, c: Candidate, trademarks: dict[tuple[str, str], str], existing: dict[str, dict[str, Any]]) -> Outcome:
        rel = c.path.relative_to(self.root)
        if c.problem in ("ambiguous", "bad_type"):
            return self._park(c, "ambiguous", c.note)
        if c.problem == "unparseable" or not c.gazette or not c.serial:
            return self._park(c, "unmatched", c.note or "cannot parse")

        tm_id = trademarks.get((c.gazette, c.serial))
        if tm_id is None:
            return self._park(c, "unmatched", f"no trademark with gazette {c.gazette} serial {c.serial}")

        ext = c.path.suffix.lower().replace(".jpeg", ".jpg")
        suffix = "" if c.image_type == "logo" else f"_{c.image_type}"
        storage_path = f"{c.gazette}/{c.serial}{suffix}{ext}"
        thumb_path = f"thumbs/{c.gazette}/{c.serial}{suffix}.webp"

        data = c.path.read_bytes()
        digest = sha256(data)
        prev = existing.get(storage_path)

        if prev and prev.get("content_hash") == digest and prev.get("trademark_id") == tm_id:
            return Outcome("skipped", c, "identical bytes already imported", storage_path, tm_id)

        action = "updated" if prev else "inserted"
        if self.dry_run:
            return Outcome(action, c, f"would {action[:-1]} → {storage_path}", storage_path, tm_id)

        w, h, thumb = probe_and_thumb(data)
        try:
            self.sb.upload(storage_path, data, content_type_for(c.path))
            if thumb:
                self.sb.upload(thumb_path, thumb, "image/webp")
            row = {
                "trademark_id": tm_id,
                "image_type": c.image_type,
                "status": "matched",
                "match_method": "gazette_serial_filename",
                "storage_bucket": self.sb.bucket,
                "storage_path": storage_path,
                "thumbnail_path": thumb_path if thumb else None,
                "original_filename": c.path.name,
                "source_folder": str(rel.parent),
                "gazette_number": c.gazette,
                "serial_number": c.serial,
                "width": w, "height": h,
                "byte_size": len(data),
                "content_type": content_type_for(c.path),
                "content_hash": digest,
                "import_job_id": self.job_id,
            }
            if prev:
                self.sb.update("trademark_images", {"id": f"eq.{prev['id']}"}, row)
            else:
                self.sb.insert("trademark_images", [row])
            # verify
            check = self.sb.select("trademark_images", {"select": "id,trademark_id", "storage_bucket": f"eq.{self.sb.bucket}", "storage_path": f"eq.{storage_path}"})
            if not check or check[0]["trademark_id"] != tm_id:
                raise RuntimeError("post-write verification failed")
            if not self.sb.object_exists(storage_path):
                raise RuntimeError("object not found in storage after upload")
            return Outcome(action, c, storage_path, storage_path, tm_id)
        except Exception as e:
            LOG.error("%s: %s", rel, e)
            return Outcome("failed", c, str(e), storage_path, tm_id)

    def _park(self, c: Candidate, status: str, message: str) -> Outcome:
        """Unmatched/ambiguous: never attach. In a real run, preserve the file
        under _unmatched/ and create a review-queue row."""
        LOG.warning("%s: %s — %s", status.upper(), c.path.relative_to(self.root), message)
        if self.dry_run:
            return Outcome(status, c, message)
        try:
            data = c.path.read_bytes()
            storage_path = f"_unmatched/{c.gazette or 'unknown'}/{c.path.name}"
            self.sb.upload(storage_path, data, content_type_for(c.path))
            w, h, thumb = probe_and_thumb(data)
            thumb_path = None
            if thumb:
                thumb_path = f"thumbs/{storage_path}".rsplit(".", 1)[0] + ".webp"
                self.sb.upload(thumb_path, thumb, "image/webp")
            self.sb.insert("trademark_images", [{
                "trademark_id": None,
                "image_type": c.image_type,
                "status": status,
                "match_method": None,
                "storage_bucket": self.sb.bucket,
                "storage_path": storage_path,
                "thumbnail_path": thumb_path,
                "original_filename": c.path.name,
                "source_folder": str(c.path.relative_to(self.root).parent),
                "gazette_number": c.gazette,
                "serial_number": c.serial,
                "width": w, "height": h,
                "byte_size": len(data),
                "content_type": content_type_for(c.path),
                "content_hash": sha256(data),
                "import_job_id": self.job_id,
                "review_note": message,
            }], upsert_on="storage_bucket,storage_path")
            return Outcome(status, c, message, storage_path)
        except Exception as e:
            return Outcome("failed", c, f"{message}; while parking: {e}")


# --------------------------------------------------------------------------- #
# Reporting
# --------------------------------------------------------------------------- #
def print_report(rep: Report, dry_run: bool, verbose: bool) -> None:
    line = "─" * 60
    print()
    for g in sorted(rep.gazettes, key=lambda x: (x == "?", x.zfill(8))):
        c = rep.gazettes[g]
        total = sum(c.values())
        print(f"Gazette {g}")
        print(f"  Images found:      {total}")
        print(f"  Matched (new):     {c['inserted']}")
        print(f"  Matched (update):  {c['updated']}")
        print(f"  Already imported:  {c['skipped']}")
        print(f"  Missing trademark: {c['unmatched']}")
        print(f"  Ambiguous:         {c['ambiguous']}")
        if c["failed"]:
            print(f"  FAILED:            {c['failed']}")
        print()
    t = rep.totals
    print(line)
    print(f"TOTAL  files={sum(t.values())}  inserted={t['inserted']}  updated={t['updated']}  skipped={t['skipped']}  unmatched={t['unmatched']}  ambiguous={t['ambiguous']}  failed={t['failed']}")
    problems = [o for o in rep.outcomes if o.status in ("unmatched", "ambiguous", "failed")]
    if problems and (verbose or len(problems) <= 40):
        print(line)
        for o in problems:
            print(f"  [{o.status:9}] {o.candidate.path.name:32} {o.message}")
    elif problems:
        print(f"({len(problems)} problem files — rerun with --verbose or see --report-json)")
    print(line)
    if dry_run:
        print("DRY RUN — NO FILES UPLOADED, NO ROWS WRITTEN")
    else:
        status = "FAILED" if t["failed"] else ("COMPLETED WITH WARNINGS" if (t["unmatched"] or t["ambiguous"]) else "COMPLETED")
        print(f"IMPORT {status}")


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", required=True, type=Path, help="folder containing gazette sub-folders / image files")
    ap.add_argument("--gazette", help="only process this gazette number")
    ap.add_argument("--dry-run", action="store_true", help="report what would happen; write nothing")
    ap.add_argument("--serial-width", type=int, default=3, help="zero-padding of the serial suffix (1011-002 → 3)")
    ap.add_argument("--bucket", default=os.environ.get("SUPABASE_BUCKET", "trademark-images"))
    ap.add_argument("--local-storage-dir", type=Path, help="LOCAL DEV: write files here instead of Supabase Storage")
    ap.add_argument("--report-json", type=Path, help="write the full per-file outcome list to this JSON file")
    ap.add_argument("--verbose", "-v", action="store_true")
    ap.add_argument("--env", type=Path, default=Path(__file__).with_name(".env"))
    args = ap.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(levelname)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    load_env(args.env)

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (importers/.env).", file=sys.stderr)
        return 2
    if not args.root.is_dir():
        print(f"--root {args.root} is not a directory", file=sys.stderr)
        return 2
    if not args.local_storage_dir and not url.startswith("https://"):
        LOG.warning("SUPABASE_URL is not https — is this really the production project?")

    sb = Supabase(url, key, args.bucket, local_dir=args.local_storage_dir)
    imp = Importer(sb, args.root.resolve(), args.dry_run, args.serial_width, args.gazette)
    rep = imp.run()
    print_report(rep, args.dry_run, args.verbose)

    if args.report_json:
        args.report_json.write_text(json.dumps([{
            "file": str(o.candidate.path.relative_to(imp.root)), "status": o.status, "gazette": o.candidate.gazette,
            "serial": o.candidate.serial, "image_type": o.candidate.image_type, "storage_path": o.storage_path,
            "trademark_id": o.trademark_id, "message": o.message,
        } for o in rep.outcomes], indent=2, ensure_ascii=False))
        print(f"report written to {args.report_json}")

    t = rep.totals
    return 1 if t["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
