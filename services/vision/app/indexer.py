"""Resumable, idempotent indexing of the trademark images already in Storage.

    pending  = admin_image_analysis_pending(model, limit, retry_failed)   -- DB decides what is missing
    analyse  = download public object → OCR + embedding (this process)
    store    = admin_upsert_image_analysis(model, items)                  -- one row per image id (upsert)

Every call processes at most `limit` images and returns a report; the caller
(admin UI button or the CLI) simply calls again until `pending` is 0. Images
that fail are stored with status 'failed' + the error, so they are visible in
the status report and can be retried explicitly — nothing is ever marked
indexed without a stored embedding or OCR result.
"""
from __future__ import annotations

import time

from . import embed as clip
from .analysis import analyze
from .preprocess import ImageError
from .supabase_client import Supabase

MAX_OBJECT_BYTES = 25 * 1024 * 1024
UPSERT_CHUNK = 50


def model_version() -> str:
    return clip.MODEL_VERSION


def run_batch(sb: Supabase, bearer: str | None, *, limit: int = 100, retry_failed: bool = False) -> dict:
    t0 = time.time()
    limit = max(1, min(int(limit or 100), 500))
    pending = sb.rpc("admin_image_analysis_pending", {"p_model": model_version(), "p_limit": limit, "p_retry_failed": bool(retry_failed)}, bearer) or []
    report = {"model_version": model_version(), "requested": limit, "attempted": len(pending), "indexed": 0, "failed": 0,
              "ocr_with_text": 0, "failures": [], "duration_ms": 0}
    items: list[dict] = []

    def flush() -> None:
        nonlocal items
        if not items:
            return
        chunk, items = items, []
        res = sb.rpc("admin_upsert_image_analysis", {"p_model": model_version(), "p_items": chunk}, bearer) or {}
        report["indexed"] += int(res.get("indexed", 0))
        report["failed"] += int(res.get("failed", 0))
        for r in res.get("results", []):
            if r.get("status") == "failed" and len(report["failures"]) < 25:
                report["failures"].append({"image_id": r.get("image_id"), "reason": r.get("error") or "rejected"})

    for img in pending:
        item = {"image_id": img["id"]}
        started = time.time()
        try:
            data = sb.download(img.get("storage_bucket") or "trademark-images", img["storage_path"], MAX_OBJECT_BYTES)
            a = analyze(data)
            o = a.get("ocr") or {}
            if a.get("embedding") is None and not o.get("words"):
                raise RuntimeError("; ".join(a.get("warnings") or ["no usable signal"]))
            item.update({
                "status": "indexed",
                "ocr_text": o.get("text") or None,
                "ocr_confidence": o.get("confidence"),
                "ocr_words": o.get("words") or [],
                "ocr_scripts": o.get("scripts") or [],
                "embedding": a.get("embedding"),
                "warnings": a.get("warnings") or [],
                "width": a["image"]["width"], "height": a["image"]["height"],
            })
            if o.get("words"):
                report["ocr_with_text"] += 1
        except ImageError as e:
            item.update({"status": "failed", "error": f"{e.code}: {e}"})
        except Exception as e:  # network, decode, model
            item.update({"status": "failed", "error": f"{type(e).__name__}: {str(e)[:200]}"})
        item["duration_ms"] = int((time.time() - started) * 1000)
        items.append(item)
        if len(items) >= UPSERT_CHUNK:
            flush()
    flush()
    report["duration_ms"] = int((time.time() - t0) * 1000)
    return report
