#!/usr/bin/env python3
"""Retrieval evaluation for Search by Image — runs the REAL browser path.

Every query image goes through exactly what a visitor's browser does (driven
with Playwright against the Vite dev server of web/):

    image ─▶ analyseImage()  (Tesseract.js in a Web Worker: words + variants)
          ─▶ describeImage() (v1 visual descriptor)
          ─▶ rpc search_trademarks_hybrid (words present) | search_trademarks_by_image (no words)
          ─▶ ranked rows

and measures, per query category, whether the expected trademark (same gazette
number + serial) is at rank 1 / within the top 3 / top 5, OCR success and
latency. The stored side must have been indexed first (tools/image_index
`index --all` for the words, Import Center → "Image index" for the descriptors;
pass --build-descriptor-index to let this script build the descriptor index
through the same browser code).

Query categories come from a folder of REAL registry images plus `meta.json`
(list of {file, serial, gazette, mark_name}) — no synthetic logos:

    exact          the stored image itself
    transformed    JPEG q20 · 1/3 size + blur · inverted · tinted background
    low_quality    1/4 size + JPEG q15 + noise
    other_font     the Latin word(s) of the mark rendered in other fonts/weights
    spelling       one-edit misspellings of those words rendered as text
    cross_script   the Persian/Arabic word of a bilingual mark rendered alone
    cross_script_latin  a Latin transliteration of a Persian-only mark rendered as text
    symbol_only    marks whose name says "device" / that OCR cannot read
    blank / noise  empty and random images (expect graceful handling, no results)

Usage (local stack: scripts/local-stack + `npm run dev` in web/):
    python3 tools/image_index/evaluate.py --images local-storage/trademark-images \
        --meta /path/to/meta.json --web http://127.0.0.1:5173 --admin-token "$LOCAL_ADMIN_KEY" \
        --build-descriptor-index --out /tmp/eval_report.json

Nothing is written to the database except (optionally) the v1 descriptor index.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import random
import re
import statistics
import sys
import time
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps, features

FONT_DIRS = ["/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/truetype/liberation", "/usr/share/fonts/truetype/noto"]
LATIN_FONTS = ["DejaVuSerif-Bold.ttf", "LiberationMono-Bold.ttf", "DejaVuSans-Oblique.ttf", "LiberationSerif-Italic.ttf"]
ARABIC_FONTS = ["NotoNaskhArabic-Bold.ttf", "NotoKufiArabic-Regular.ttf", "NotoSansArabic-Bold.ttf"]
ARABIC = re.compile(r"[\u0600-\u06FF]")

# Runs inside the page: the same calls useImageSearch.ts makes, minus the React state.
BROWSER_QUERY_JS = """
async ({ b64, mime, name, limit }) => {
  const t0 = performance.now()
  const { analyseImage } = await import('/src/lib/imageSearch/analyze.ts')
  const { describeImage, toVector, DESCRIPTOR_VERSION } = await import('/src/lib/imageSearch/descriptor.ts')
  const { searchTrademarksHybrid, HYBRID_DEFAULTS } = await import('/src/services/image_analysis_service.ts')
  const { searchTrademarksByDescriptor, IMAGE_SEARCH_MIN_SIMILARITY } = await import('/src/services/image_search_service.ts')
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const blob = new File([bytes], name, { type: mime })
  const out = { analyze_ms: 0, search_ms: 0, ocr_text: '', ocr_conf: null, blank: false, warnings: [], variants: [], path: null, rows: [], error: null }
  let a
  try {
    a = await analyseImage(blob)
  } catch (e) {
    out.error = (e && e.name) || 'analyse_failed'
    out.analyze_ms = Math.round(performance.now() - t0)
    return out
  }
  out.analyze_ms = Math.round(performance.now() - t0)
  const ocr = a.ocr
  const confident = (ocr?.words ?? []).filter((w) => w.confidence >= 60)
  const text = (confident.length ? confident : ocr?.words ?? []).map((w) => w.text).join(' ')
  out.ocr_text = text
  out.ocr_conf = ocr?.confidence ?? null
  out.blank = !!a.image.blank
  out.warnings = a.warnings
  out.variants = a.variants.map((v) => v.text)
  const terms = a.image.blank ? [] : text.split(/[\\s,;/|]+/).map((w) => w.trim()).filter((w) => w.length >= 2).slice(0, 12)
  const t1 = performance.now()
  try {
    const descriptor = await describeImage(blob)
    if (terms.length) {
      out.path = 'hybrid'
      const rows = await searchTrademarksHybrid({ embedding: null, terms, variants: out.variants, descriptor: toVector(descriptor), descriptorVersion: DESCRIPTOR_VERSION, limit })
      out.rows = rows.map((r) => ({ gazette: r.official_gazette_number, serial: r.serial_number, mark: r.mark_name, score: r.combined_score, types: r.match_types }))
    } else {
      out.path = 'basic'
      const rows = await searchTrademarksByDescriptor(descriptor, limit, IMAGE_SEARCH_MIN_SIMILARITY)
      out.rows = rows.map((r) => ({ gazette: r.official_gazette_number, serial: r.serial_number, mark: r.mark_name, score: r.similarity, types: ['visual'] }))
    }
  } catch (e) {
    out.error = (e && (e.message || e.name)) || 'search_failed'
  }
  out.search_ms = Math.round(performance.now() - t1)
  return out
}
"""

BROWSER_BUILD_INDEX_JS = """
async () => {
  const { listImagesNeedingIndex, indexStoredImages, getImageIndexStatus } = await import('/src/services/image_search_service.ts')
  let total = { attempted: 0, indexed: 0, failed: 0 }
  for (let round = 0; round < 50; round++) {
    const need = await listImagesNeedingIndex(200, 0)
    if (!need.length) break
    const rep = await indexStoredImages(need.map((n) => ({ id: n.id, storage_bucket: n.storage_bucket, storage_path: n.storage_path })))
    total.attempted += rep.attempted; total.indexed += rep.indexed; total.failed += rep.failed
    if (rep.indexed === 0) break
  }
  return { ...total, status: await getImageIndexStatus() }
}
"""


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


def rank_of(rows: list[dict], gazette: str, serial: str) -> int | None:
    for i, row in enumerate(rows):
        if row.get("gazette") == gazette and row.get("serial") == serial:
            return i + 1
    return None


def build_queries(meta: list[dict], images: Path) -> list[dict]:
    queries: list[dict] = []
    for m in meta:
        p = images / m["file"]
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
        if aw and not lw:  # Persian-only record → Latin transliteration (from the app's own variant generator) rendered as text
            queries.append(dict(category="cross_script_latin", name=f"{aw[0]}→latin", data=None, translit_of=aw[0], **base))
        if (not lw and not aw) or re.search(r"device|oval|bottle", m["mark_name"], re.I):
            queries.append(dict(category="symbol_only", name=f"{m['file']}#symbol", data=p.read_bytes(), **base))
    queries.append(dict(category="blank", name="blank.png", data=to_png(Image.new("RGB", (300, 200), "white")), gazette="-", serial="-", mark="-"))
    noise = Image.effect_noise((256, 256), 64).convert("RGB")
    queries.append(dict(category="noise", name="noise.png", data=to_png(noise), gazette="-", serial="-", mark="-"))
    return queries


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", required=True, help="folder with the stored images (paths in meta.json are relative to it)")
    ap.add_argument("--meta", default="", help="meta.json (default: <images>/meta.json)")
    ap.add_argument("--web", default="http://127.0.0.1:5173", help="Vite dev server of web/ configured for the same database")
    ap.add_argument("--admin-token", default="", help="local-stack admin JWT (only needed with --build-descriptor-index)")
    ap.add_argument("--build-descriptor-index", action="store_true", help="build the v1 descriptor index first (admin)")
    ap.add_argument("--out", default="eval_report.json")
    ap.add_argument("--max", type=int, default=0, help="limit number of base images (0 = all)")
    ap.add_argument("--only", default="", help="comma-separated categories to run (default all)")
    ap.add_argument("--limit", type=int, default=10, help="results requested per query")
    args = ap.parse_args()
    images = Path(args.images)
    meta = json.loads(Path(args.meta or images / "meta.json").read_text())
    if args.max:
        meta = meta[: args.max]

    from playwright.sync_api import sync_playwright  # imported late: only needed to run

    queries = build_queries(meta, images)
    if args.only:
        wanted = {c.strip() for c in args.only.split(",") if c.strip()}
        queries = [q for q in queries if q["category"] in wanted]

    results: list[dict] = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context()
        page = ctx.new_page()
        console: list[str] = []
        page.on("console", lambda m: console.append(f"{m.type}: {m.text}") if m.type == "error" else None)
        if args.admin_token:
            page.add_init_script(f"sessionStorage.setItem('tmistan.localAdminToken', {json.dumps(args.admin_token)})")
        page.goto(f"{args.web}/?mode=image", wait_until="networkidle")
        page.wait_for_timeout(1500)
        if args.build_descriptor_index:
            rep = page.evaluate(BROWSER_BUILD_INDEX_JS)
            print("descriptor index:", json.dumps(rep, ensure_ascii=False))
        # warm the OCR engine once so the first query does not pay the download
        warm = page.evaluate(BROWSER_QUERY_JS, {"b64": base64.b64encode(render("WARM UP", "DejaVuSans-Bold.ttf")).decode(), "mime": "image/png", "name": "warm.png", "limit": 1})
        print("engine warm-up:", warm.get("ocr_text"), f"{warm.get('analyze_ms')} ms", warm.get("error") or "")

        def run_query(data: bytes, name: str) -> dict:
            mime = "image/jpeg" if data[:3] == b"\xff\xd8\xff" else "image/png"
            return page.evaluate(BROWSER_QUERY_JS, {"b64": base64.b64encode(data).decode(), "mime": mime, "name": name, "limit": args.limit})

        for q in queries:
            rec = {k: q[k] for k in ("category", "name", "gazette", "serial", "mark")}
            if q.get("data") is None and q.get("translit_of"):
                probe = run_query(render(q["translit_of"], ARABIC_FONTS[0], size=72), "t.png")
                variants = [v for v in probe.get("variants", []) if ARABIC.search(v) is None]
                if probe.get("error") or not variants:
                    rec.update(error=probe.get("error") or "no_latin_variant", analyze_ms=probe.get("analyze_ms")); results.append(rec); continue
                data = render(variants[0].upper(), "DejaVuSans-Bold.ttf")
                rec["name"] = f"{q['translit_of']}→{variants[0]}"
            else:
                data = q["data"]
            r = run_query(data, q["name"].split("@")[0][:40] + ".png")
            rec.update(analyze_ms=r["analyze_ms"], search_ms=r["search_ms"], ocr_text=r["ocr_text"], ocr_conf=r["ocr_conf"], warnings=r["warnings"], blank=r["blank"], path=r["path"])
            if r.get("error"):
                rec["error"] = r["error"]; results.append(rec); continue
            rows = r["rows"]
            rec["n_results"] = len(rows)
            rec["top"] = rows[:3]
            rec["rank"] = rank_of(rows, q["gazette"], q["serial"])
            results.append(rec)
            print(f"{q['category']:<18} {rec['name'][:38]:<38} rank={rec['rank']} path={r['path']} ocr={r['ocr_text'][:28]!r} {r['analyze_ms']}ms/{r['search_ms']}ms")
        browser.close()

    summary: dict[str, dict] = {}
    for cat in sorted({r["category"] for r in results}):
        rs = [r for r in results if r["category"] == cat]
        ranked = [r for r in rs if "rank" in r]
        summary[cat] = {
            "queries": len(rs),
            "errors": sum(1 for r in rs if r.get("error")),
            "ocr_text_found": sum(1 for r in rs if r.get("ocr_text")),
            "hybrid_path": sum(1 for r in rs if r.get("path") == "hybrid"),
            "top1": sum(1 for r in ranked if r.get("rank") == 1),
            "top3": sum(1 for r in ranked if r.get("rank") and r["rank"] <= 3),
            "top5": sum(1 for r in ranked if r.get("rank") and r["rank"] <= 5),
            "no_results": sum(1 for r in ranked if r.get("n_results") == 0),
            "analyze_ms_median": round(statistics.median([r["analyze_ms"] for r in rs if r.get("analyze_ms") is not None])) if rs else None,
            "search_ms_median": round(statistics.median([r["search_ms"] for r in rs if r.get("search_ms") is not None])) if ranked else None,
        }
    report = {"web": args.web, "n_images": len(meta), "summary": summary, "results": results, "console_errors": console[:20],
              "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=1))
    print("\n=== summary ===")
    print(f"{'category':<20}{'n':>4}{'top1':>6}{'top3':>6}{'top5':>6}{'none':>6}{'ocr':>5}{'hyb':>5}{'err':>5}{'analyze ms':>12}{'search ms':>11}")
    for cat, s in summary.items():
        print(f"{cat:<20}{s['queries']:>4}{s['top1']:>6}{s['top3']:>6}{s['top5']:>6}{s['no_results']:>6}{s['ocr_text_found']:>5}{s['hybrid_path']:>5}{s['errors']:>5}{str(s['analyze_ms_median']):>12}{str(s['search_ms_median']):>11}")
    if console:
        print(f"browser console errors: {len(console)} (first: {console[0][:160]})")
    print("report:", args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
