"""Tesseract OCR for trademark images — Latin (eng) and Arabic-script (fas + pus).

Native Tesseract 5 (via pytesseract) with the SAME tessdata_fast models the
browser downloads from web/public/ocr/tessdata, so offline-indexed rows and
browser-recognised queries use the same recogniser family and model version
(version.py). Returns recognised words with per-word confidence and script,
never a single "confirmed" string: low-confidence readings are flagged
`uncertain`.
"""
from __future__ import annotations

import gzip
import os
import re
import shutil
import time
from dataclasses import dataclass, field
from pathlib import Path

import pytesseract
from PIL import Image

from .preprocess import Loaded, ocr_variants
from .textnorm import normalize, plausible_token, script_of
from .version import IMAGE_ANALYSIS_MODEL, OCR_LANGS, TESSDATA_SOURCE

LATIN_LANG = "eng"
ARABIC_LANG = "fas+pus"
MIN_WORD_CONF = float(os.environ.get("OCR_MIN_WORD_CONF", "55"))
CONFIDENT = 75.0
OCR_TIMEOUT_S = float(os.environ.get("OCR_TIMEOUT_SECONDS", "8"))      # per Tesseract pass
OCR_BUDGET_S = float(os.environ.get("OCR_BUDGET_SECONDS", "7"))        # no new pass after this
OCR_VERSION = IMAGE_ANALYSIS_MODEL
ENGINE = "tesseract-native"

_TESSDATA: Path | None = None


def tessdata_dir() -> Path:
    """Directory with eng/fas/pus .traineddata — gunzipped once from the files the web app
    ships (web/public/ocr/tessdata), so both sides use byte-identical models. Override with
    TESSDATA_DIR when the models were installed elsewhere."""
    global _TESSDATA
    if _TESSDATA is not None:
        return _TESSDATA
    env = os.environ.get("TESSDATA_DIR")
    if env:
        _TESSDATA = Path(env)
        return _TESSDATA
    target = Path(__file__).resolve().parent / ".tessdata"
    target.mkdir(exist_ok=True)
    for lang in OCR_LANGS:
        out = target / f"{lang}.traineddata"
        src = TESSDATA_SOURCE / f"{lang}.traineddata.gz"
        if out.exists() and (not src.exists() or out.stat().st_mtime >= src.stat().st_mtime):
            continue
        if not src.exists():
            raise FileNotFoundError(f"{src} is missing — run from a checkout of the repository or set TESSDATA_DIR")
        with gzip.open(src, "rb") as fh:
            out.write_bytes(fh.read())
    _TESSDATA = target
    return target


@dataclass
class OcrWord:
    text: str
    normalized: str
    conf: float
    script: str
    lang: str
    variant: str


@dataclass
class OcrResult:
    words: list[OcrWord] = field(default_factory=list)
    text: str = ""
    confidence: float = 0.0
    scripts: list[str] = field(default_factory=list)
    uncertain: bool = True
    passes: int = 0
    duration_ms: int = 0
    error: str | None = None

    def to_dict(self) -> dict:
        return {
            "text": self.text,
            "confidence": round(self.confidence, 1),
            "scripts": self.scripts,
            "uncertain": self.uncertain,
            "words": [
                {"text": w.text, "normalized": w.normalized, "confidence": round(w.conf, 1), "script": w.script, "lang": w.lang}
                for w in self.words
            ],
            "passes": self.passes,
            "duration_ms": self.duration_ms,
            "engine": ENGINE,
            "model": OCR_VERSION,
            "error": self.error,
        }


def available() -> tuple[bool, str, list[str]]:
    """(tesseract found, version, languages available in the tessdata dir)."""
    if not shutil.which("tesseract"):
        return False, "", []
    try:
        ver = str(pytesseract.get_tesseract_version())
        langs = pytesseract.get_languages(config=f'--tessdata-dir "{tessdata_dir()}"')
    except Exception:  # pragma: no cover
        return False, "", []
    return True, ver, langs


def _run(img: Image.Image, lang: str, psm: int, variant: str) -> list[OcrWord]:
    cfg = f'--oem 1 --psm {psm} --tessdata-dir "{tessdata_dir()}"'
    try:
        data = pytesseract.image_to_data(img, lang=lang, config=cfg, output_type=pytesseract.Output.DICT, timeout=OCR_TIMEOUT_S)
    except (pytesseract.TesseractError, RuntimeError):
        return []
    out: list[OcrWord] = []
    wanted = "latin" if lang == LATIN_LANG else "arabic"
    for text, conf in zip(data.get("text", []), data.get("conf", [])):
        try:
            c = float(conf)
        except (TypeError, ValueError):
            continue
        raw = (text or "").strip()
        if not raw or c < MIN_WORD_CONF:
            continue
        # a Tesseract "word" may still contain punctuation glue → split on it
        for piece in re.split(r"[\s\-_/|\\.,;:!?()\[\]{}\"'`«»]+", raw):
            if not piece:
                continue
            norm = normalize(piece)
            if not norm:
                continue
            s = script_of(norm)
            if s == "digit":
                if plausible_token(norm, s):
                    out.append(OcrWord(piece, norm, c, s, lang, variant))
                continue
            if s != wanted or not plausible_token(norm, s):
                continue
            out.append(OcrWord(piece, norm, c, s, lang, variant))
    return out


def recognise(loaded: Loaded) -> OcrResult:
    """Adaptive multi-pass OCR: block mode on the normal rendition for both scripts;
    the inverted rendition and sparse mode only when nothing confident was found."""
    t0 = time.time()
    res = OcrResult()
    if loaded.blank:
        res.duration_ms = int((time.time() - t0) * 1000)
        res.error = "blank"
        return res
    variants = ocr_variants(loaded)
    found: list[OcrWord] = []
    passes = 0

    def good(ws: list[OcrWord]) -> bool:
        return any(w.conf >= CONFIDENT and len(w.normalized) >= 3 for w in ws)

    def budget_left() -> bool:
        return (time.time() - t0) < OCR_BUDGET_S

    name, img = variants[0]
    for lang in (LATIN_LANG, ARABIC_LANG):
        found += _run(img, lang, 6, name); passes += 1
    if not good(found) and budget_left():
        name, img = variants[1]
        for lang in (LATIN_LANG, ARABIC_LANG):
            if not budget_left():
                break
            found += _run(img, lang, 6, name); passes += 1
    if not found and budget_left():                 # sparse mode only when nothing plausible at all
        name, img = variants[0]
        for lang in (LATIN_LANG, ARABIC_LANG):
            if not budget_left():
                break
            found += _run(img, lang, 11, name); passes += 1

    # merge duplicates (same normalised token): keep reading order, best confidence
    order: list[str] = []
    best: dict[str, OcrWord] = {}
    for w in found:
        cur = best.get(w.normalized)
        if cur is None:
            best[w.normalized] = w
            order.append(w.normalized)
        elif w.conf > cur.conf:
            best[w.normalized] = w
    words = [best[k] for k in order]
    # Latin and Arabic passes can both "read" the same glyphs; keep the script with the
    # higher confidence when readings compete heavily.
    lat = [w for w in words if w.script == "latin"]
    ara = [w for w in words if w.script == "arabic"]
    if lat and ara:
        lat_c = max(w.conf for w in lat); ara_c = max(w.conf for w in ara)
        if lat_c >= CONFIDENT and ara_c < MIN_WORD_CONF + 10 and len(ara) <= 1:
            words = [w for w in words if w.script != "arabic"]
        elif ara_c >= CONFIDENT and lat_c < MIN_WORD_CONF + 10 and len(lat) <= 1:
            words = [w for w in words if w.script != "latin"]
    # pure digit strings (serial numbers, page noise) only matter when they are all there is
    lettered = [w for w in words if w.script != "digit"]
    if lettered:
        words = lettered
    words = words[:12]
    res.words = words
    res.passes = passes
    res.text = " ".join(w.text for w in words)
    res.confidence = (sum(w.conf for w in words) / len(words)) if words else 0.0
    res.scripts = sorted({w.script for w in words if w.script in ("latin", "arabic")})
    res.uncertain = not words or res.confidence < CONFIDENT
    res.duration_ms = int((time.time() - t0) * 1000)
    return res
