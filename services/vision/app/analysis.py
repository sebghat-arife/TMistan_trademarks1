"""One image → OCR words, transliteration variants and a CLIP embedding."""
from __future__ import annotations

import os
import time

from . import embed as clip
from . import ocr
from .preprocess import ImageError, clip_pixels, load_image
from .textnorm import variants_for

MAX_UPLOAD_BYTES = int(float(os.environ.get("MAX_UPLOAD_MB", "8")) * 1024 * 1024)


def analyze(data: bytes, *, want_ocr: bool = True, want_embedding: bool = True) -> dict:
    """Raises ImageError for unusable input. Modalities fail independently: a missing
    model or an OCR crash is reported in the payload instead of failing the request."""
    t0 = time.time()
    loaded = load_image(data, MAX_UPLOAD_BYTES)
    out: dict = {
        "image": {
            "width": loaded.width, "height": loaded.height, "format": loaded.format, "blank": loaded.blank,
            "content_box": list(loaded.content_box),
        },
        "ocr": None,
        "variants": [],
        "embedding": None,
        "models": {"ocr": ocr.OCR_VERSION, "embedding": clip.MODEL_VERSION},
        "warnings": [],
        "timings_ms": {},
    }
    if loaded.blank:
        out["warnings"].append("blank")
    if want_ocr:
        try:
            r = ocr.recognise(loaded)
            out["ocr"] = r.to_dict()
            out["timings_ms"]["ocr"] = r.duration_ms
            if r.words:
                out["variants"] = variants_for([w.normalized for w in r.words])
            elif not loaded.blank:
                out["warnings"].append("no_text")
        except Exception as e:  # OCR must never take the visual channel down
            out["warnings"].append("ocr_failed")
            out["ocr"] = {"error": type(e).__name__, "words": [], "text": "", "confidence": 0, "uncertain": True, "scripts": []}
    if want_embedding and not loaded.blank:
        try:
            vec, ms = clip.embed(clip_pixels(loaded))
            out["embedding"] = vec
            out["timings_ms"]["embedding"] = ms
        except Exception as e:
            out["warnings"].append("embedding_unavailable")
            out["embedding_error"] = type(e).__name__
    out["timings_ms"]["total"] = int((time.time() - t0) * 1000)
    return out


__all__ = ["analyze", "ImageError", "MAX_UPLOAD_BYTES"]
