# tools/image_index — offline text indexer for *Search by Image* ($0)

Recognises the words in the trademark images already stored in Supabase Storage and saves them to
`public.trademark_image_analysis`, so that **Search by Image** can match the words a visitor's
picture contains against the words in every stored image. It runs on **your own PC or in a GitHub
Codespace** — no server, no paid service, nothing stays online afterwards (Supabase serves the
index). The Import Center offers the same indexing inside the administrator's browser; this tool is
simply faster for the whole archive (≈ 1,200 images in 10–20 minutes on a laptop) and does not need
the tab to stay open.

Both indexers and the visitor's browser use the **same recogniser family and the same language
models** (Tesseract 5 LSTM, `tessdata_fast` `eng` + `fas` + `pus`, copied from
`web/public/ocr/tessdata`) and write the same model version (`version.py` =
`OCR_MODEL_VERSION` in `web/src/lib/imageSearch/ocr.ts`), so rows are interchangeable.

What is stored per image: status (`indexed` = words found · `skipped` = nothing readable ·
`failed`), the recognised text (original and normalised), per-word confidence/script, warnings,
duration, engine, attempts. **Never** stored or changed: the image bytes, `trademark_images`,
`trademarks`. Re-running updates the existing row (one row per image and model version).

## 1. Install (once)

**Windows 10/11**

1. Python 3.11+ from python.org (tick *Add to PATH*).
2. Tesseract 5 — installer from <https://github.com/UB-Mannheim/tesseract/wiki> (default path
   `C:\Program Files\Tesseract-OCR`). Add that folder to `PATH`, or set
   `PYTESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe`. No extra language packs are
   needed: the tool uses the models shipped in this repository.
3. In a terminal, from the repository root:
   ```
   python -m venv .venv && .venv\Scripts\activate
   pip install -r tools\image_index\requirements.txt
   ```

**macOS / Linux**: `brew install tesseract` or `sudo apt install tesseract-ocr`, then the same
`python3 -m venv … && pip install -r tools/image_index/requirements.txt`.

**GitHub Codespaces** (free tier: 120 core-hours/month on a 2-core machine — a full run uses well
under one hour): open the repository in a Codespace, then
```
sudo apt-get update && sudo apt-get install -y tesseract-ocr
pip install -r tools/image_index/requirements.txt
```

## 2. Configure

The tool reads the **public** Supabase values from `web/.env.local` (or the environment):
```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
```
and authenticates as **you**, the administrator (`--login your@email`; password prompted, or set
`TMISTAN_ADMIN_PASSWORD` for unattended runs). The database functions check the admin role exactly
as they do for the Import Center — no secret key is involved. On a trusted machine you may instead
pass `--service-key` to use `SUPABASE_SERVICE_ROLE_KEY` from the git-ignored `importers/.env`;
never copy that key anywhere else.

Database prerequisite: **`supabase/APPLY_1300.sql`** applied once (Supabase → SQL Editor; it
contains migrations 1200 + 1300, both additive). `check` tells you if it is missing.

## 3. Run

```
python -m tools.image_index check                              # tesseract, models, database, migration
python -m tools.image_index analyse path\to\logo.png           # local test — prints words, nothing written
python -m tools.image_index --login you@example.com status     # with text / skipped / pending / failed
python -m tools.image_index --login you@example.com index --limit 20     # small sample first
python -m tools.image_index --login you@example.com index --all          # everything that is pending
```

After the sample run, open the public site → *Search by Image* and try a few of those marks (a
photo of the logo, the word in another font, the Persian spelling). Then run `--all`.

Options for `index`:

| Option | Meaning |
|---|---|
| `--limit N` | images per round (default 100, max 500) |
| `--all` | keep taking rounds until nothing is pending |
| `--retry-failed` | also take images whose last attempt failed (download error, undecodable file) |
| `--include-skipped` | re-analyse images recorded as *no readable text* (after a model or pre-processing change) |
| `--workers N` | parallel images (default = CPU count, ≤ 4) |
| `--dry-run` | list what would be analysed, write nothing |

Progress is printed per image with an ETA; results are saved every 25 images, so **Ctrl-C** is safe
(press once: finishes the images in progress and saves; the next run continues where it stopped).
Images imported later show up as *pending* in the Import Center panel and here — run `index` again
(or use the panel's *Analyse next N* button).

## 4. Expectations and limits (measured on real registry images, see `docs/IMAGE_SEARCH.md` §5)

* Tesseract reads clean Latin lettering and typeset Persian/Pashto well; it finds **no** usable
  text in roughly 30 % of the stored images (stylised, outlined, hand-drawn or very small
  lettering, pure devices). Those are stored as `skipped` and remain searchable **visually** only
  (near-duplicate descriptor).
* Readings of stylised Arabic script are often partial. The search tolerates spelling distance and
  transliteration variants, but it is not a vision model: a logo with no readable text and no
  near-identical stored copy will not be found by text.
* Throughput: ≈ 0.3–1 s per image per worker (CPU). Network: each image is downloaded once from the
  public bucket (≈ 40 MB for the whole archive).

## 5. Evaluation harness

`evaluate.py` replays the **real browser path** (Tesseract.js in Chromium via Playwright + the
visual descriptor + the database functions) for several query categories derived from real images
(exact, transformed, low quality, other fonts, misspellings, Persian-only, symbol-only, blank,
noise) and prints top-1/3/5 hit rates and latencies. It needs the local stack
(`scripts/local-stack/`), `npm run dev` in `web/` and `pip install playwright && playwright install chromium`:

```
python3 tools/image_index/evaluate.py --images local-storage/trademark-images --meta sample/meta.json \
    --web http://127.0.0.1:5173 --admin-token "$LOCAL_ADMIN_KEY" --build-descriptor-index --out eval.json
```
