"""Model/version constants shared with the web app.

`IMAGE_ANALYSIS_MODEL` MUST equal `OCR_MODEL_VERSION` in
web/src/lib/imageSearch/ocr.ts: the database keeps one analysis row per
(image, model version) and the search pins the version the browser knows about,
so rows written under another string would simply be ignored by the search.
Bump BOTH when the language models in web/public/ocr/tessdata change.
"""
from __future__ import annotations

from pathlib import Path

IMAGE_ANALYSIS_MODEL = "tesseract-fast-eng-fas-pus-v1"
OCR_LANGS = ("eng", "fas", "pus")

# The gzipped tessdata_fast models the web app serves to browsers (single source of truth).
TESSDATA_SOURCE = Path(__file__).resolve().parents[2] / "web" / "public" / "ocr" / "tessdata"
