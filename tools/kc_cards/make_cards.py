#!/usr/bin/env python3
"""
Render the typographic thumbnails for the Knowledge Center law & procedure
articles (web/public/img/kc/<slug>.jpg, 600×480).

The cards are plain typography on the TMistan design tokens (ivory background,
brand-green band, Source Serif 4 / Inter) — no stock, AI-generated or historic
imagery, in line with web/public/img/CREDITS.md. Fonts are read from the web
app's own @fontsource packages so the cards match the interface.

Usage (from the repo root, after `cd web && npm ci`):
    pip install playwright pillow && python -m playwright install chromium
    python tools/kc_cards/make_cards.py            # all cards
    python tools/kc_cards/make_cards.py <slug>...  # selected cards
"""
from __future__ import annotations

import base64
import io
import sys
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / "web"
OUT = WEB / "public" / "img" / "kc"
FONTS = WEB / "node_modules" / "@fontsource-variable"

# slug -> (eyebrow, key fact, caption)
CARDS: dict[str, tuple[str, str, str]] = {
    "trademark-registration-process-afghanistan": ("Law on Trade Marks Registration · OG No. 995", "Application → Gazette", "How trademark registration works in Afghanistan"),
    "afghanistan-trademark-law-overview": ("Official Gazette No. 995 · 1 September 2009", "5 chapters · 36 articles", "The Law on Trade Marks Registration, in overview"),
    "what-can-be-registered-as-a-trademark-in-afghanistan": ("Articles 4 and 8", "15 excluded categories", "What can and cannot be registered as a trademark"),
    "trademark-opposition-in-afghanistan": ("Articles 25–30", "30 days", "The objection window after Gazette publication"),
    "trademark-renewal-and-validity-afghanistan": ("Articles 19–22", "10 years", "Validity, renewal and lapse of a registration"),
    "madrid-protocol-afghanistan": ("Madrid Protocol · WIPO", "26 June 2018", "In force for Afghanistan (AF): international registrations"),
    "afghanistan-ip-treaties": ("WIPO Lex · Afghanistan", "2005 → 2021", "Eight WIPO-administered treaties and what they mean"),
    "trademark-assignment-and-ownership-changes": ("Articles 13, 17 and 18", "Assignment · Change · Merger", "Ownership and address changes in Gazette records"),
    "well-known-marks-afghanistan": ("Articles 3 and 9", "Used in two or more countries", "Well-known marks under Afghan law"),
    "trademark-infringement-and-penalties-afghanistan": ("Articles 31–33", "Compensation · Confiscation", "Violations, remedies and penalties"),
    "first-use-and-ownership-afghanistan": ("Articles 21, 22 and 29", "First use", "Who owns a trademark — registration, use and non-use"),
    "how-to-check-if-a-trademark-is-taken-in-afghanistan": ("Research guide", "6 steps", "Checking whether a trademark is already taken"),
    "nice-classes-for-common-goods-and-services": ("Nice Classification · WIPO", "45 classes", "Choosing classes for common goods and services"),
    "trademark-search-for-foreign-companies-afghanistan": ("Articles 7, 10 and 15 · Paris · Madrid", "6-month priority", "Trademark research for foreign businesses"),
    "glossary-of-afghanistan-trademark-terms": ("Reference", "A → Z", "Glossary of Afghanistan trademark terms"),
}

HTML = """<!doctype html><html><head><meta charset="utf-8">
<style>
@font-face {{ font-family: "Source Serif 4 Variable"; src: url("data:font/woff2;base64,{serif}") format("woff2"); font-weight: 200 900; }}
@font-face {{ font-family: "Inter Variable"; src: url("data:font/woff2;base64,{inter}") format("woff2"); font-weight: 100 900; }}
html, body {{ margin: 0; width: 600px; height: 480px; background: #f7f7f1; }}
.card {{ position: relative; width: 600px; height: 480px; box-sizing: border-box; padding: 44px 44px 40px 58px; overflow: hidden; }}
.band {{ position: absolute; left: 0; top: 0; bottom: 0; width: 14px; background: #087747; }}
.rule {{ position: absolute; left: 58px; right: 44px; bottom: 92px; height: 1px; background: #dfe2e7; }}
.corner {{ position: absolute; right: 24px; top: 24px; width: 88px; height: 88px; border-top: 1px solid #b7c9bf; border-right: 1px solid #b7c9bf; opacity: .8; }}
.eyebrow {{ font: 600 13px/1.3 "Inter Variable", sans-serif; letter-spacing: .14em; text-transform: uppercase; color: #087747; }}
.fact {{ margin-top: 78px; font: 600 {fact_size}px/1.05 "Source Serif 4 Variable", Georgia, serif; color: #102b43; letter-spacing: -.01em; }}
.caption {{ margin-top: 22px; font: 400 21px/1.35 "Source Serif 4 Variable", Georgia, serif; color: #3a4654; max-width: 470px; }}
.foot {{ position: absolute; left: 58px; bottom: 40px; display: flex; align-items: center; gap: 10px; font: 500 12.5px/1 "Inter Variable", sans-serif; color: #6b7684; letter-spacing: .02em; }}
.foot img {{ width: 28px; height: 28px; }}
.foot b {{ color: #102b43; font-weight: 600; }}
</style></head><body>
<div class="card">
  <div class="band"></div>
  <div class="corner"></div>
  <div class="eyebrow">{eyebrow}</div>
  <div class="fact">{fact}</div>
  <div class="caption">{caption}</div>
  <div class="rule"></div>
  <div class="foot"><img src="data:image/png;base64,{logo}" alt=""><span><b>TMistan</b> · Knowledge Center</span></div>
</div></body></html>"""


def fact_size(fact: str) -> int:
    n = len(fact)
    if n <= 10:
        return 72
    if n <= 16:
        return 56
    if n <= 24:
        return 44
    return 36


def main(slugs: list[str]) -> None:
    serif = FONTS / "source-serif-4" / "files" / "source-serif-4-latin-wght-normal.woff2"
    inter = FONTS / "inter" / "files" / "inter-latin-wght-normal.woff2"
    logo = WEB / "public" / "brand" / "logo.png"
    for p in (serif, inter, logo):
        if not p.exists():
            sys.exit(f"missing {p} — run `cd web && npm ci` first")
    OUT.mkdir(parents=True, exist_ok=True)
    # Inline assets as data URIs: a set_content() page has an opaque origin and cannot read file:// URLs.
    b64 = {k: base64.b64encode(v.read_bytes()).decode("ascii") for k, v in {"serif": serif, "inter": inter, "logo": logo}.items()}
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": 600, "height": 480}, device_scale_factor=2)
        for slug in slugs:
            eyebrow, fact, caption = CARDS[slug]
            page.set_content(HTML.format(serif=b64["serif"], inter=b64["inter"], logo=b64["logo"], eyebrow=eyebrow, fact=fact, caption=caption, fact_size=fact_size(fact)))
            page.evaluate("document.fonts.ready")
            page.wait_for_timeout(150)
            png = page.screenshot(type="png")
            img = Image.open(io.BytesIO(png)).convert("RGB").resize((600, 480), Image.LANCZOS)
            img.save(OUT / f"{slug}.jpg", "JPEG", quality=86, optimize=True, progressive=True)
            print("wrote", OUT / f"{slug}.jpg")
        browser.close()


if __name__ == "__main__":
    wanted = sys.argv[1:] or list(CARDS)
    unknown = [s for s in wanted if s not in CARDS]
    if unknown:
        sys.exit(f"unknown slug(s): {', '.join(unknown)}")
    main(wanted)
