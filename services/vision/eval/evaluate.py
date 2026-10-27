#!/usr/bin/env python3
"""Retrieval evaluation for the intelligent image search.

Runs the *real* production path for every query image:

    image ──POST /analyze──▶ vision service ──▶ words + variants + embedding
          ──rpc search_trademarks_hybrid──▶ PostgREST (publishable key) ──▶ ranked rows

and measures, per query category, whether the expected trademark (same gazette
number + serial) is at rank 1 / within the top 3 / top 5, OCR success and latency.

Query categories are derived from a folder of REAL registry images plus a
`meta.json` (list of {file, serial, gazette, mark_name}) — no synthetic logos:

    exact          the stored image itself
    transformed    JPEG q20 · 1/3 size + blur · inverted · tinted background
    low_quality    1/4 size + JPEG q15 + noise
    other_font     the Latin word(s) of the mark rendered in other fonts/weights
    spelling       one-edit misspellings of those words rendered as text
    cross_script   the Persian/Arabic word of a bilingual mark rendered alone,
                   and the Latin word of a mark whose record only has Persian
    symbol_only    marks whose name says "device" / that OCR cannot read
    blank          empty image (expects a graceful "blank" + no results)

Usage:
    VISION_API_URL=http://127.0.0.1:8000 SUPABASE_URL=http://127.0.0.1:54321 \
    SUPABASE_PUBLISHABLE_KEY=... python3 evaluate.py --sample /path/to/sample --out report.json

Nothing is written to the database; the publishable key is sufficient.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import random
import re
import statistics
import sys
import time
from pathlib import Path

import httpx
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps, features

API = os.environ.get("VISION_API_URL", "http://127.0.0.1:8000").rstrip("/")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
REST_URL = os.environ.get("SUPABASE_REST_URL", "").rstrip("/") or f"{SUPABASE_URL}/rest/v1"
KEY = os.environ.get("SUPABASE_PUBLISHABLE_KEY") or os.environ.get("SUPABASE_ANON_KEY", "")

FONT_DIRS = ["/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/truetype/liberation", "/usr/share/fonts/truetype/noto"]
LATIN_FONTS = ["DejaVuSerif-Bold.ttf", "LiberationMono-Bold.ttf", "DejaVuSans-Oblique.ttf", "LiberationSerif-Italic.ttf"]
ARABIC_FONTS = ["NotoNaskhArabic-Bold.ttf", "NotoKufiArabic-Regular.ttf", "NotoSansArabic-Bold.ttf"]
ARABIC = re.compile(r"[\u0600-\u06FF]")


def font(name: str, size: int):
    for d in FONT_DIRS:
        p = Path(d) / name
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def render(text: str, fname: str, size: int = 64, fg="black", bg="white", pad=24) -> bytes:
    f = font(fname, size)
    if ARABIC.search(text) and not features.check("raqm"):
        try:  # shape Arabic only when PIL lacks raqm (which shapes + reorders itself)
            import arabic_reshaper  # type: ignore
            from bidi.algorithm import get_display  # type: ignore
            text = get_display(arabic_reshaper.reshape(text))
        except Exception:
            print("warning: PIL has no raqm and arabic_reshaper/python-bidi are missing — Arabic renders will be wrong", file=sys.stderr)
    dummy = Image.new("RGB", (10, 10))
    box = ImageDraw.Draw(dummy).textbbox((0, 0), text, font=f)
    w, h = box[2] - box[0] + 2 * pad, box[3] - box[1] + 2 * pad
    img = Image.new("RGB", (max(w, 120), max(h, 80)), bg)
    ImageDraw.Draw(img).text((pad - box[0], pad - box[1]), text, font=f, fill=fg)
    return to_png(img)


def to_png(img: Image.Image) -> bytes:
    b = io.BytesIO(); img.save(b, format="PNG"); return b.getvalue()


def to_jpeg(img: Image.Image, q: int) -> bytes:
    b = io.BytesIO(); img.convert("RGB").save(b, format="JPEG", quality=q); return b.getvalue()


def transforms(img: Image.Image) -> dict[str, bytes]:
    rgb = img.convert("RGB")
    small = rgb.resize((max(16, rgb.width // 3), max(16, rgb.height // 3)), Image.BILINEAR).filter(ImageFilter.GaussianBlur(0.8))
    tint = Image.new("RGB", rgb.size, (255, 236, 200))
    tinted = Image.blend(rgb, tint, 0.35)
    return {
        "jpeg_q20": to_jpeg(rgb, 20),
        "third_blur": to_png(small),
        "inverted": to_png(ImageOps.invert(rgb)),
        "tinted": to_png(tinted),
    }


def low_quality(img: Image.Image) -> bytes:
    rgb = img.convert("L").resize((max(16, img.width // 4), max(16, img.height // 4)), Image.BILINEAR)
    px = rgb.load()
    rnd = random.Random(7)
    for y in range(rgb.height):
        for x in range(rgb.width):
            if rnd.random() < 0.04:
                px[x, y] = rnd.choice((0, 255))
    return to_jpeg(rgb, 15)


def latin_words(mark: str) -> list[str]:
    stop = {"and", "device", "the", "of", "a", "with", "in", "logo", "brand", "oval"}
    ws = [w for w in re.findall(r"[A-Za-z]{3,}", mark) if w.lower() not in stop]
    return ws[:3]


def arabic_words(mark: str) -> list[str]:
    return [w for w in re.findall(r"[\u0600-\u06FF]{2,}", mark)]


def misspell(word: str) -> str:
    w = word.lower()
    if len(w) < 4:
        return w + w[-1]
    i = len(w) // 2
    sw = {"o": "u", "u": "o", "i": "ee", "e": "a", "a": "e", "k": "c", "c": "k", "s": "z", "z": "s"}
    ch = w[i]
    return (w[:i] + sw[ch] + w[i + 1:]) if ch in sw else (w[:i] + w[i + 1:])


# ----------------------------------------------------------------------------
def analyze(client: httpx.Client, data: bytes, name: str) -> tuple[dict | None, float, str | None]:
    t = time.time()
    for attempt in range(6):
        r = client.post(f"{API}/analyze", files={"image": (name, data, "image/png")})
        if r.status_code != 429:
            break
        time.sleep(float(r.headers.get("Retry-After", "5")))   # respect the service rate limit
    dt = (time.time() - t) * 1000
    if r.status_code != 200:
        try:
            return None, dt, r.json().get("error", {}).get("code", str(r.status_code))
        except Exception:
            return None, dt, str(r.status_code)
    return r.json(), dt, None


def rpc_search(client: httpx.Client, analysis: dict, terms: list[str] | None = None) -> tuple[list[dict], float, str | None]:
    words = terms if terms is not None else [w["text"] for w in analysis.get("ocr", {}).get("words", []) if not analysis["ocr"].get("uncertain") or w["confidence"] >= 60]
    body = {
        "p_embedding": analysis.get("embedding"),
        "p_terms": words or None,
        "p_variants": [v["text"] for v in analysis.get("variants", [])] or None,
        "p_model": (analysis.get("models") or {}).get("embedding"),
        "p_limit": 10,
    }
    if body["p_embedding"] is None and not body["p_terms"] and not body["p_variants"]:
        return [], 0.0, "nothing_to_search"
    t = time.time()
    r = client.post(f"{REST_URL}/rpc/search_trademarks_hybrid", json=body,
                    headers={"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    dt = (time.time() - t) * 1000
    if r.status_code >= 400:
        return [], dt, f"rpc {r.status_code}: {r.text[:200]}"
    return r.json(), dt, None


def rank_of(rows: list[dict], gazette: str, serial: str) -> int | None:
    for i, row in enumerate(rows):
        if row.get("official_gazette_number") == gazette and row.get("serial_number") == serial:
            return i + 1
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", required=True, help="folder with images + meta.json")
    ap.add_argument("--out", default="eval_report.json")
    ap.add_argument("--max", type=int, default=0, help="limit number of base images (0 = all)")
    ap.add_argument("--only", default="", help="comma-separated categories to run (default all)")
    args = ap.parse_args()
    sample = Path(args.sample)
    meta = json.loads((sample / "meta.json").read_text())
    if args.max:
        meta = meta[: args.max]
    if not KEY or not SUPABASE_URL and not os.environ.get("SUPABASE_REST_URL"):
        print("SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY required", file=sys.stderr)
        return 2

    client = httpx.Client(timeout=120)
    health = client.get(f"{API}/health").json()
    print("service:", json.dumps({k: health.get(k) for k in ("ok", "ocr", "embedding")}, ensure_ascii=False))

    queries: list[dict] = []  # {category, name, data, gazette, serial, mark, terms_override}
    for m in meta:
        p = sample / m["file"]
        img = Image.open(p); img.load()
        base = dict(gazette=m["gazette"], serial=m["serial"], mark=m["mark_name"])
        queries.append(dict(category="exact", name=m["file"], data=p.read_bytes(), **base))
        for k, d in transforms(img).items():
            queries.append(dict(category="transformed", name=f"{m['file']}#{k}", data=d, **base))
        queries.append(dict(category="low_quality", name=f"{m['file']}#lowq", data=low_quality(img), **base))
        lw = latin_words(m["mark_name"])
        aw = arabic_words(m["mark_name"])
        if lw:
            phrase = " ".join(lw[:2])
            for fnt in LATIN_FONTS[:3]:
                queries.append(dict(category="other_font", name=f"{phrase}@{fnt}", data=render(phrase, fnt, fg="#1b2a4a", bg="#f3f1e8"), **base))
            queries.append(dict(category="spelling", name=f"{misspell(lw[0])}@sans", data=render(misspell(lw[0]).upper(), "DejaVuSans-Bold.ttf"), **base))
        if aw and lw:  # bilingual record → query with the Persian word only
            for fnt in ARABIC_FONTS[:2]:
                queries.append(dict(category="cross_script", name=f"{aw[0]}@{fnt}", data=render(aw[0], fnt, size=72), **base))
        if aw and not lw:  # Persian-only record → query with a Latin transliteration rendered as text
            queries.append(dict(category="cross_script_latin", name=f"{aw[0]}→latin", data=None, translit_of=aw[0], **base))
        if (not lw and not aw) or re.search(r"device|oval|bottle", m["mark_name"], re.I):
            queries.append(dict(category="symbol_only", name=f"{m['file']}#symbol", data=p.read_bytes(), **base))
    queries.append(dict(category="blank", name="blank.png", data=to_png(Image.new("RGB", (300, 200), "white")), gazette="-", serial="-", mark="-"))
    noise = Image.effect_noise((256, 256), 64).convert("RGB")
    queries.append(dict(category="noise", name="noise.png", data=to_png(noise), gazette="-", serial="-", mark="-"))

    if args.only:
        wanted = {c.strip() for c in args.only.split(",") if c.strip()}
        queries = [q for q in queries if q["category"] in wanted]
    # Latin transliterations of Persian-only marks: use the service's own variant generator on the rendered Persian word
    results = []
    for q in queries:
        rec = {k: q[k] for k in ("category", "name", "gazette", "serial", "mark")}
        if q.get("data") is None and q.get("translit_of"):
            data = render(q["translit_of"], ARABIC_FONTS[0], size=72)
            a, dt, err = analyze(client, data, "t.png")
            variants = [v["text"] for v in (a or {}).get("variants", []) if ARABIC.search(v["text"]) is None]
            if not a or not variants:
                rec.update(error=err or "no_latin_variant", analyze_ms=dt); results.append(rec); continue
            data = render(variants[0].upper(), "DejaVuSans-Bold.ttf")
            rec["name"] = f"{q['translit_of']}→{variants[0]}"
        else:
            data = q["data"]
        a, dt, err = analyze(client, data, q["name"].split("@")[0][:40] + ".png")
        rec["analyze_ms"] = round(dt)
        if a is None:
            rec["error"] = err; results.append(rec); continue
        ocr = a.get("ocr", {})
        rec["ocr_text"] = ocr.get("text", "")
        rec["ocr_conf"] = ocr.get("confidence")
        rec["warnings"] = a.get("warnings", [])
        rec["blank"] = a.get("image", {}).get("blank")
        rows, sdt, serr = rpc_search(client, a)
        rec["search_ms"] = round(sdt)
        if serr:
            rec["error"] = serr; results.append(rec); continue
        rec["n_results"] = len(rows)
        rec["top"] = [dict(mark=r["mark_name"], serial=r["serial_number"], score=r["combined_score"], types=r["match_types"]) for r in rows[:3]]
        rec["rank"] = rank_of(rows, q["gazette"], q["serial"])
        results.append(rec)
        print(f"{q['category']:<18} {q['name'][:38]:<38} rank={rec['rank']} ocr={rec['ocr_text'][:28]!r} {rec['analyze_ms']}ms/{rec['search_ms']}ms")

    # ---- summary ------------------------------------------------------------
    summary: dict[str, dict] = {}
    for cat in sorted({r["category"] for r in results}):
        rs = [r for r in results if r["category"] == cat]
        ranked = [r for r in rs if "rank" in r]
        n = len(rs)
        summary[cat] = {
            "queries": n,
            "errors": sum(1 for r in rs if r.get("error")),
            "ocr_text_found": sum(1 for r in rs if r.get("ocr_text")),
            "top1": sum(1 for r in ranked if r.get("rank") == 1),
            "top3": sum(1 for r in ranked if r.get("rank") and r["rank"] <= 3),
            "top5": sum(1 for r in ranked if r.get("rank") and r["rank"] <= 5),
            "no_results": sum(1 for r in ranked if r.get("n_results") == 0),
            "analyze_ms_median": round(statistics.median([r["analyze_ms"] for r in rs if "analyze_ms" in r])) if rs else None,
            "search_ms_median": round(statistics.median([r["search_ms"] for r in rs if "search_ms" in r])) if ranked else None,
        }
    report = {"service": health, "api": API, "rest": REST_URL, "n_images": len(meta), "summary": summary, "results": results,
              "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=1))
    print("\n=== summary ===")
    print(f"{'category':<20}{'n':>4}{'top1':>6}{'top3':>6}{'top5':>6}{'none':>6}{'ocr':>5}{'err':>5}{'analyze ms':>12}{'search ms':>11}")
    for cat, s in summary.items():
        print(f"{cat:<20}{s['queries']:>4}{s['top1']:>6}{s['top3']:>6}{s['top5']:>6}{s['no_results']:>6}{s['ocr_text_found']:>5}{s['errors']:>5}{str(s['analyze_ms_median']):>12}{str(s['search_ms_median']):>11}")
    print("report:", args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
