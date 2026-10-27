#!/usr/bin/env python3
"""End-to-end checks for Search by Image (zero-cost design) against the local stack.

Prerequisites: scripts/local-stack running (PostgreSQL + PostgREST 54321 + storage stub 54322),
`npm run dev` in web/ configured for it (SUPABASE_URL=/supabase …), the 48-image sample seeded and
indexed (tools/image_index `index --all`; v1 descriptors via evaluate.py --build-descriptor-index),
`pip install playwright && playwright install chromium`.

    LOCAL_ADMIN_KEY=… python3 scripts/e2e/image_search_e2e.py [--web http://127.0.0.1:5173] [--images local-storage/trademark-images]

Each check prints PASS/FAIL; exit code 1 if any failed. Nothing is deleted; the admin checks only
re-analyse 'skipped' rows (idempotent upsert) and verify no duplicate rows appear.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import Page, sync_playwright

RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail else ""), flush=True)


def png_bytes(img: Image.Image) -> bytes:
    b = io.BytesIO(); img.save(b, format="PNG"); return b.getvalue()


def text_image(text: str, size: int = 64) -> bytes:
    f = None
    for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"):
        if Path(p).exists():
            f = ImageFont.truetype(p, size); break
    f = f or ImageFont.load_default()
    dummy = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    box = dummy.textbbox((0, 0), text, font=f)
    img = Image.new("RGB", (box[2] - box[0] + 60, box[3] - box[1] + 60), "white")
    ImageDraw.Draw(img).text((30 - box[0], 30 - box[1]), text, font=f, fill="black")
    return png_bytes(img)


def upload(page: Page, name: str, data: bytes, mime: str = "image/png") -> None:
    page.get_by_test_id("image-input").first.set_input_files({"name": name, "mimeType": mime, "buffer": data})


def wait_recognition(page: Page, timeout_s: int = 90) -> str | None:
    """Returns which recognition state appeared: 'words' | 'none' | 'engine_failed' | None."""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if page.get_by_test_id("recognition-engine-failed").count():
            return "engine_failed"
        if page.get_by_test_id("recognition-none").count():
            return "none"
        inp = page.get_by_test_id("recognition-input")
        if inp.count() and inp.first.input_value().strip():
            return "words"
        page.wait_for_timeout(500)
    return None


def submit_and_wait(page: Page, timeout_s: int = 60) -> list[str]:
    page.get_by_test_id("image-search-submit").first.click()
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if page.get_by_test_id("image-results").count() or page.get_by_test_id("image-results-section").count():
            page.wait_for_timeout(300)
            break
        page.wait_for_timeout(300)
    return result_serials(page)


def result_serials(page: Page) -> list[str]:
    items = page.locator("[data-testid=image-results] li")
    out = []
    for i in range(items.count()):
        txt = items.nth(i).inner_text()
        for tok in txt.split():
            if "-" in tok and tok.split("-")[0].isdigit():
                out.append(tok.strip()); break
    return out


def db_counts(admin_key: str, rest: str) -> dict:
    body = json.dumps({"p_model": "tesseract-fast-eng-fas-pus-v1"}).encode()
    req = urllib.request.Request(f"{rest}/rpc/admin_image_analysis_status", data=body, headers={
        "apikey": admin_key, "Authorization": f"Bearer {admin_key}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--web", default="http://127.0.0.1:5173")
    ap.add_argument("--rest", default="http://127.0.0.1:54321")
    ap.add_argument("--images", default="local-storage/trademark-images")
    ap.add_argument("--shots", default="/tmp/e2e_shots")
    args = ap.parse_args()
    admin_key = os.environ.get("LOCAL_ADMIN_KEY", "")
    images = Path(args.images)
    shots = Path(args.shots); shots.mkdir(parents=True, exist_ok=True)
    rakhsh = next(images.glob("1027/1027-078-*.png"))   # "RAKHSH / رخش" — clear Latin + Persian wordmark
    bottle = next(images.glob("1027/1027-072-*.png"))   # bottle device, no readable text
    samandar = next(images.glob("1027/1027-077-*.png")) # "SAMANDAR / سمندر"

    with sync_playwright() as pw:
        browser = pw.chromium.launch()

        # ── 1. public page, intelligent mode announced only when ready ─────────────────────────
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        page = ctx.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"{args.web}/?mode=image", wait_until="networkidle"); page.wait_for_timeout(1500)
        check("mode: intelligent badge shown (migration + index + browser ready)", page.get_by_test_id("image-mode-intelligent").count() == 1 and page.get_by_test_id("ocr-enable").count() == 0)
        check("privacy line says the image is analysed in the browser", "analysed in your browser" in page.get_by_test_id("image-dropzone").first.inner_text() or "analysed in your browser" in page.content())

        # ── 2. wordmark: words recognised, editable, found at rank 1 ──────────────────────────
        upload(page, rakhsh.name, rakhsh.read_bytes())
        state = wait_recognition(page)
        words = page.get_by_test_id("recognition-input").first.input_value() if state == "words" else ""
        check("wordmark: words recognised in the browser", state == "words" and "RAKHSH" in words.upper(), f"state={state} words={words!r}")
        serials = submit_and_wait(page)
        check("wordmark: expected record at rank 1", serials[:1] == ["1027-078"], str(serials[:5]))
        sw = page.get_by_test_id("image-searched-with").first.inner_text().lower() if page.get_by_test_id("image-searched-with").count() else ""
        check("wordmark: searched-with lists the recognised wording and the near-duplicate check", "wording" in sw and "duplicate" in sw, sw[:100])
        check("wordmark: no 'limited' note", page.get_by_test_id("image-limited-note").count() == 0)
        page.screenshot(path=str(shots / "01_wordmark_results.png"), full_page=True)

        # ── 3. exact-duplicate option ─────────────────────────────────────────────────────────
        page.get_by_test_id("option-exact").first.click()
        serials = submit_and_wait(page)
        check("exact option: the same image is a near-duplicate hit", "1027-078" in serials[:3], str(serials[:5]))
        page.get_by_test_id("option-similar").first.click()

        # ── 4. symbol-only image → no words, near-duplicate channel, limited note ──────────────
        page.get_by_test_id("replace-image").first.click() if page.get_by_test_id("replace-image").count() else None
        upload(page, bottle.name, bottle.read_bytes())
        state = wait_recognition(page)
        check("symbol-only: 'no readable text' notice", state == "none", f"state={state}")
        serials = submit_and_wait(page)
        check("symbol-only: found by the near-duplicate check", serials[:1] == ["1027-072"], str(serials[:5]))
        check("symbol-only: limited note shown (no text used)", page.get_by_test_id("image-limited-note").count() == 1)

        # ── 5. visitor types the wording of a symbol-only mark ────────────────────────────────
        page.get_by_test_id("recognition-input").first.fill("SAMANDAR")
        serials = submit_and_wait(page)
        check("typed wording: text channel finds the record", "1027-077" in serials[:3], str(serials[:5]))

        # ── 6. other font / misspelling / Persian rendered as text ────────────────────────────
        for label, txt, expect in (("other font", "Samandar", "1027-077"), ("misspelling", "SAMANDER", "1027-077"), ("Persian script", "سمندر", "1027-077")):
            upload(page, "t.png", text_image(txt))
            state = wait_recognition(page)
            serials = submit_and_wait(page)
            check(f"{label} rendered as image: record in top 3", expect in serials[:3], f"state={state} {serials[:5]}")

        # ── 7. invalid / blank uploads ────────────────────────────────────────────────────────
        upload(page, "notes.txt", b"hello", "text/plain")
        page.wait_for_timeout(800)
        check("invalid file type rejected with a message", page.get_by_test_id("image-error").count() == 1, page.get_by_test_id("image-error").first.inner_text()[:80] if page.get_by_test_id("image-error").count() else "")
        upload(page, "blank.png", png_bytes(Image.new("RGB", (300, 200), "white")))
        page.wait_for_timeout(2500)
        err_txt = page.get_by_test_id("image-error").first.inner_text() if page.get_by_test_id("image-error").count() else ""
        check("blank image flagged", "blank" in err_txt.lower() or page.get_by_test_id("recognition-none").count() == 1, err_txt[:80])
        upload(page, "broken.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 64)
        page.wait_for_timeout(2500)
        check("corrupt image rejected", page.get_by_test_id("image-error").count() == 1)
        check("no uncaught page errors so far", not errors, "; ".join(errors)[:200])
        ctx.close()

        # ── 8. data-saver connection → opt-in button, then enable ─────────────────────────────
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        ctx.add_init_script("Object.defineProperty(navigator, 'connection', { get: () => ({ saveData: true }) })")
        page = ctx.new_page()
        page.goto(f"{args.web}/?mode=image", wait_until="networkidle"); page.wait_for_timeout(1500)
        basic = page.get_by_test_id("image-mode-basic")
        check("save-data: basic mode with reason + opt-in button", basic.count() == 1 and basic.first.get_attribute("data-reason") == "save_data" and page.get_by_test_id("ocr-enable").count() == 1)
        page.get_by_test_id("ocr-enable").first.click()
        for _ in range(120):
            if page.get_by_test_id("image-mode-intelligent").count():
                break
            page.wait_for_timeout(500)
        check("save-data: after opting in the engine loads and intelligent mode is announced", page.get_by_test_id("image-mode-intelligent").count() == 1)
        ctx.close()

        # ── 9. browser without WebAssembly → basic mode, searches still work ──────────────────
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        ctx.add_init_script("delete window.WebAssembly; Object.defineProperty(window, 'WebAssembly', { get: () => undefined })")
        page = ctx.new_page()
        page.goto(f"{args.web}/?mode=image", wait_until="networkidle"); page.wait_for_timeout(1500)
        basic = page.get_by_test_id("image-mode-basic")
        check("unsupported browser: basic mode with reason ocr_unsupported", basic.count() == 1 and basic.first.get_attribute("data-reason") == "ocr_unsupported")
        upload(page, bottle.name, bottle.read_bytes())
        page.wait_for_timeout(1500)
        serials = submit_and_wait(page)
        check("unsupported browser: near-duplicate search still returns the record", serials[:1] == ["1027-072"], str(serials[:5]))
        ctx.close()

        # ── 10. recogniser download fails → notice + visual search still runs ─────────────────
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        blocked = {"on": True}
        ctx.route("**/ocr/tessdata/**", lambda route: route.abort() if blocked["on"] else route.continue_())   # language models unreachable → engine cannot start
        page = ctx.new_page()
        page.goto(f"{args.web}/?mode=image", wait_until="networkidle"); page.wait_for_timeout(1500)
        upload(page, rakhsh.name, rakhsh.read_bytes())
        for _ in range(60):
            if page.get_by_test_id("image-mode-basic").count() and page.get_by_test_id("image-mode-basic").first.get_attribute("data-reason") == "ocr_failed":
                break
            page.wait_for_timeout(500)
        basic = page.get_by_test_id("image-mode-basic")
        basic_txt = basic.first.inner_text() if basic.count() else ""
        check("engine failure: basic mode with reason ocr_failed, message + retry offered", basic.count() == 1 and basic.first.get_attribute("data-reason") == "ocr_failed" and page.get_by_test_id("ocr-retry").count() == 1 and "could not be downloaded" in basic_txt, basic_txt[:140])
        check("engine failure: the words field stays available for typing", page.get_by_test_id("recognition-input").count() == 1)
        serials = submit_and_wait(page)
        check("engine failure: visual search still returns the record", "1027-078" in serials[:3], str(serials[:5]))
        blocked["on"] = False                        # network back → Retry must recover without a reload
        page.get_by_test_id("ocr-retry").first.click()
        state = wait_recognition(page, 90)
        words = page.get_by_test_id("recognition-input").first.input_value() if state == "words" else ""
        check("engine failure: Retry starts the engine and analyses the selected image", state == "words" and "RAKHSH" in words.upper() and page.get_by_test_id("image-mode-intelligent").count() == 1, f"state={state} words={words!r}")
        ctx.close()

        # ── 11. migration missing (status RPC answers PGRST202) → basic mode, reason shown ────
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        ctx.route("**/rpc/hybrid_image_search_status", lambda route: route.fulfill(status=404, content_type="application/json", body=json.dumps({"code": "PGRST202", "message": "Could not find the function public.hybrid_image_search_status"})))
        page = ctx.new_page()
        page.goto(f"{args.web}/?mode=image", wait_until="networkidle"); page.wait_for_timeout(1500)
        basic = page.get_by_test_id("image-mode-basic")
        check("migration missing: basic mode with reason migration_missing", basic.count() == 1 and basic.first.get_attribute("data-reason") == "migration_missing")
        upload(page, bottle.name, bottle.read_bytes())
        page.wait_for_timeout(1500)
        serials = submit_and_wait(page)
        check("migration missing: v1 search still works", serials[:1] == ["1027-072"], str(serials[:5]))
        ctx.close()

        # ── 12. mobile + RTL (Dari) ───────────────────────────────────────────────────────────
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        ctx.add_init_script("localStorage.setItem('i18nextLng', 'fa')")
        page = ctx.new_page()
        page.goto(f"{args.web}/?mode=image", wait_until="networkidle"); page.wait_for_timeout(1500)
        check("mobile/RTL: page is rtl and the image card renders", page.evaluate("document.documentElement.dir") == "rtl" and page.get_by_test_id("image-input").count() == 1)
        upload(page, rakhsh.name, rakhsh.read_bytes())
        state = wait_recognition(page)
        check("mobile/RTL: recognition works on a 390 px viewport", state == "words", f"state={state}")
        serials = submit_and_wait(page)
        check("mobile/RTL: results rendered", "1027-078" in serials[:3], str(serials[:5]))
        page.screenshot(path=str(shots / "02_mobile_rtl.png"), full_page=True)
        check("mobile/RTL: no horizontal overflow", page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
        ctx.close()

        # ── 13. Import Center panel (local admin) ─────────────────────────────────────────────
        if not admin_key:
            check("admin panel checks (LOCAL_ADMIN_KEY not set → skipped)", True)
        else:
            before = db_counts(admin_key, args.rest)
            ctx = browser.new_context(viewport={"width": 1280, "height": 1000})
            ctx.add_init_script(f"sessionStorage.setItem('tmistan.localAdminToken', {json.dumps(admin_key)})")
            page = ctx.new_page()
            page.goto(f"{args.web}/admin/imports/images", wait_until="networkidle"); page.wait_for_timeout(2000)
            panel = page.get_by_test_id("analysis-index-panel")
            check("admin: analysis panel rendered", panel.count() == 1)
            cov = page.get_by_test_id("analysis-coverage")
            cov_txt = cov.first.inner_text() if cov.count() else ""
            check("admin: coverage shows analysed/total", cov.count() == 1 and str(before["matched_images"]) in cov_txt, cov_txt[:80])
            check("admin: no 'paid service' wording", "service must be configured" not in page.content().lower() and "vision" not in panel.first.inner_text().lower())
            page.screenshot(path=str(shots / "03_admin_panel.png"), full_page=True)
            # re-analyse skipped in the browser (idempotent), then stop a second run
            panel.first.locator("select").first.select_option("25")
            btn = page.get_by_test_id("analysis-rerun-skipped")
            if before["skipped"] > 0 and btn.count():
                btn.first.click()
                seen_progress = False
                for _ in range(600):
                    if page.get_by_test_id("analysis-progress").count():
                        seen_progress = True
                    if page.get_by_test_id("analysis-report").count():
                        break
                    page.wait_for_timeout(500)
                rep = page.get_by_test_id("analysis-report").first.inner_text() if page.get_by_test_id("analysis-report").count() else ""
                check("admin: browser re-analysis of skipped images ran with progress and a report", seen_progress and bool(rep), rep[:120])
                after = db_counts(admin_key, args.rest)
                check("admin: no duplicate rows, counts stable", after["matched_images"] == before["matched_images"] and after["with_text"] + after["skipped"] + after["failed"] == before["with_text"] + before["skipped"] + before["failed"], json.dumps({k: after[k] for k in ("with_text", "skipped", "pending", "failed")}))
                # stop
                page.get_by_test_id("analysis-rerun-skipped").first.click()
                for _ in range(120):
                    if page.get_by_test_id("analysis-stop").count():
                        break
                    page.wait_for_timeout(250)
                if page.get_by_test_id("analysis-stop").count():
                    page.get_by_test_id("analysis-stop").first.click()
                    for _ in range(240):
                        if page.get_by_test_id("analysis-report").count() and "stopped" in page.get_by_test_id("analysis-report").first.inner_text().lower():
                            break
                        page.wait_for_timeout(500)
                    rep = page.get_by_test_id("analysis-report").first.inner_text() if page.get_by_test_id("analysis-report").count() else ""
                    check("admin: Stop ends the batch and reports it", "stopped" in rep.lower(), rep[:120])
                else:
                    check("admin: Stop button appears while running", False)
            else:
                check("admin: skipped rows available for the re-run check", False, json.dumps(before))
            ctx.close()

            # migration missing in the admin panel
            ctx = browser.new_context(viewport={"width": 1280, "height": 1000})
            ctx.add_init_script(f"sessionStorage.setItem('tmistan.localAdminToken', {json.dumps(admin_key)})")
            ctx.route("**/rpc/admin_image_analysis_status", lambda route: route.fulfill(status=404, content_type="application/json", body=json.dumps({"code": "PGRST202", "message": "Could not find the function public.admin_image_analysis_status"})))
            page = ctx.new_page()
            page.goto(f"{args.web}/admin/imports/images", wait_until="networkidle"); page.wait_for_timeout(2000)
            txt = page.get_by_test_id("analysis-index-panel").first.inner_text() if page.get_by_test_id("analysis-index-panel").count() else ""
            check("admin: migration-missing state names APPLY_1300.sql", "APPLY_1300" in txt, txt[:100])
            ctx.close()

        browser.close()

    failed = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed; screenshots in {shots}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
