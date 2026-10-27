# Search by Image

`/?mode=image` (the *Search by Image* mode of the landing page) lets a visitor drop a logo / mark
image and get the published trademarks that are **textually, visually or phonetically comparable**.
It is a *research aid* for finding candidate marks — it is not a clearance, availability or
infringement opinion, and the UI says so on every result list.

Two modes share the same UI and the same result cards:

| Mode | When | What it compares |
|---|---|---|
| **Intelligent** (this document) | migration **1200** applied **and** the vision service reachable (`VISION_API_URL`) | words recognised in the uploaded image (OCR, Latin + Arabic-script) ↔ mark names, printed text and the OCR text of every stored image; spelling + transliteration variants; CLIP visual embedding ↔ stored embeddings; the v1 near-duplicate descriptor as an extra signal |
| **Basic** (fallback, = the previous implementation) | otherwise | the 369-number perceptual descriptor computed in the browser (near-identical images only) |

The page detects the mode at load time (`hybrid_image_search_status` + `GET /health`), explains it
in the card (*"Text + visual search"* / *"Basic mode: near-identical images only"*) and degrades
automatically: if the service is down the basic mode keeps working; if OCR finds nothing the search
continues with the visual channel and says so (*"Searched with: visual similarity"*).

```
visitor's browser                 tmistan-vision (Render, Docker, CPU)              Supabase (Postgres + pgvector)
┌────────────────────────┐        ┌──────────────────────────────────────┐          ┌────────────────────────────────────────┐
│ image (≤ 8 MB)         │ POST   │ validate · EXIF orientation · crop   │          │ trademarks (mark_name, mark_print, …)  │
│  → preview             │/analyze│ Tesseract eng + fas+pus (per-word    │          │ trademark_image_analysis (RLS, no      │
│  ← recognised words,   │◀──────▶│   confidence, uncertain flag)        │          │   policies): ocr_text, ocr_text_norm,  │
│    variants, 512-d     │        │ transliteration variants             │          │   embedding vector(512), status, model │
│    embedding           │        │ CLIP ViT-B/32 int8 ONNX → 512 floats │          │   GIN trigram + HNSW cosine indexes    │
│  user edits the words  │        │ nothing stored, nothing logged       │          │                                        │
│  → rpc search_trade-   │────────────────────────────────────────────────────────▶ │ search_trademarks_hybrid()  SECURITY   │
│    marks_hybrid(terms, │                                                          │   DEFINER · published rows only ·      │
│    variants, embedding,│◀──────────────────────────────────────────────────────── │   text + visual + duplicate channels   │
│    descriptor, filters)│   ranked rows with match_types, scores and reasons       │   merged per trademark · cap 60        │
└────────────────────────┘                                                          └────────────────────────────────────────┘
Administrator → Import Center → "Intelligent image index" → service POST /admin/index/run (admin token forwarded)
  → admin_image_analysis_pending() → download image from the public bucket → OCR + embedding → admin_upsert_image_analysis()
```

## 1. One-time setup (project owner)

1. **Database** — Supabase → SQL Editor → paste **`supabase/APPLY_1200.sql`** → Run (or
   `APPLY_ALL.sql` on a fresh project). Additive and idempotent: enables `pg_trgm` + `fuzzystrmatch`
   (`vector` already from 0500), adds table `public.trademark_image_analysis`, helper functions
   `phonetic_key` / `text_match`, the public functions `search_trademarks_hybrid` /
   `hybrid_image_search_status` and the admin functions `admin_image_analysis_status` /
   `admin_image_analysis_pending` / `admin_upsert_image_analysis`. No existing table or row is
   modified; the frontend works unchanged while the migration is not applied yet (it shows basic mode).
2. **Service** — deploy `services/vision` (Render Blueprint entry `tmistan-vision` in `render.yaml`,
   or Dashboard → *New Web Service* → runtime Docker, root directory `services/vision`, health check
   `/health`). Environment: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (public), `ALLOWED_ORIGINS` =
   the static-site origin(s). First build takes a few minutes (installs Tesseract + bakes the 89 MB model into the image).
   Check `https://<service>/health` → `"ok": true`.
3. **Static site** — add `VISION_API_URL=https://<service host>` to the Render static site and
   redeploy (the value is inlined at build time). The image search card now shows
   *"Text + visual search"*.
4. **Index a small sample first** — sign in → **Admin → Import Center → Intelligent image index** →
   batch size **25** → *Analyse next 25*. Check the report (analysed / with text / failed), open the
   public page and try a few of those marks (a photo of the logo, the word in another font, the
   Persian spelling). Then run batches of 100–300 until **Pending = 0** (≈ 1 s per image on the
   Starter instance: the current 1,194 images take 20–30 minutes). `Retry failed` re-runs
   failures (404s, undecodable files) and `python -m app.cli index --all` does the same from an
   operator machine.
5. **Later** — images uploaded through the Import Center appear as *Pending* until the next batch
   is run (the panel says so). After a model change (`MODEL_VERSION` bump) all images become pending
   for the new version while the old rows keep serving searches until replaced.

## 2. How a query is processed

### 2.1 Preprocessing (`services/vision/app/preprocess.py`)
Format detected from the decoded content (JPEG/PNG/WEBP/GIF/BMP/TIFF — never from the file
extension), empty / size (8 MB) / minimum 16 px / decompression-bomb guards, EXIF orientation,
transparency flattened on white, grayscale and palette images → RGB, border background estimate +
content-box crop (so a logo on a white sheet and the same logo tightly cropped describe alike),
OCR renditions upscaled so letters are ≈ 30 px and capped at 1600 px, a 224 px letter-boxed
rendition for CLIP, blank detection (grey-level standard deviation < 4) → `400 nothing_to_search`
when nothing else is possible. Originals are never written anywhere.

### 2.2 OCR (`app/ocr.py`)
Tesseract 5 (LSTM) with `eng` for Latin and `fas+pus` for Arabic script (Persian/Dari + Pashto;
they include the Arabic letters). Passes: block mode (`--psm 6`) on the normal rendition for both
language sets; the inverted rendition (light-on-dark marks) only when no confident word (≥ 75,
≥ 3 letters) was found; a sparse-text pass (`--psm 11`) only when nothing at all was found; a time
budget (7 s) stops further passes. Words below confidence 55 are dropped, digits-only tokens are
dropped unless they are all there is, reading order is kept, Unicode is NFKC-normalised with
Arabic presentation forms folded (ي/ی, ك/ک, diacritics removed) while the **original text is kept**
too. The result carries a confidence (0–1), the detected scripts, per-word boxes and an
`uncertain` flag (no words, or mean word confidence below 75 %). The UI shows the words in an **editable field** —
uncertain readings are labelled *"Low confidence — please check"* and the visitor can correct them
before searching; the words that are actually searched are the ones in that field.

### 2.3 Transliteration / spelling variants (`app/textnorm.py`)
Conservative, rule-based, and **labelled as variants** (never merged with the recognised words):
Latin → Arabic-script (one rendering per word: `noor` → نور, `nawid` → نوید/ناوید) and Arabic-script →
Latin with the common Afghan/Persian conventions (نور → `nor`/`nur`/`noor`/`nour`, شائسته →
`shaista`/`shaysta`/`shaeesta`). The visitor can switch them off (*"Also search N possible spelling
or transliteration variants"*); the database weights them at 0.85 and labels hits *"Possible
spelling or transliteration variant"*.

### 2.4 Text channel (`text_match` in migration 1200, runs in Postgres)
Each query term (and each variant) is compared with three fields of every published trademark:
`mark_name_normalized` (weight 1.0), normalised `mark_print` (0.95) and the OCR text of its stored
images (0.9). Score per term:

| Rule | Score | Example |
|---|---|---|
| identical normalised string | 1.00 | noor ↔ noor |
| whole-word match inside the field | 0.97 | noor ↔ "noor asia" |
| substring (≥ 4 chars) / OCR glued words | 0.88 / 0.86 | nooras ↔ "noor asia" |
| Levenshtein ratio ≥ 0.7 on a token (first letter must agree for ≤ 5-letter words) | 0.72–0.95 | nawid ↔ naweed |
| same Latin phonetic key (Metaphone, `phonetic_key`) | 0.74 | nour / nor / nur ↔ noor |
| same consonant skeleton (≥ 4 consonants) | 0.70 | samandar ↔ samandr |
| trigram similarity (`pg_trgm`) | ≤ 0.96 | catch-all |

Only candidates with score ≥ `p_min_text` (0.42 default; `door ↔ noor` = 0.34 is excluded) enter
the merge. The GIN trigram index keeps this a candidate lookup, not a scan of the browser.

### 2.5 Visual channel
`trademark_image_analysis.embedding` (CLIP ViT-B/32, cosine, HNSW index) — the 200 nearest
neighbours, kept when above `p_min_visual` (0.72). Calibration on the real images: the same mark re-encoded, rescaled,
padded, inverted or tinted scores ≥ 0.95; unrelated marks score p50 0.54 / p99 0.79 / max 0.86. The
v1 descriptor table (`trademark_image_features`, if indexed) is queried too (80 nearest) and
acts as a near-duplicate detector (`≥ 0.67` on its own normalised scale).

### 2.6 Combined ranking (`search_trademarks_hybrid`)
Candidates from all channels are merged **per trademark id**, keeping the strongest evidence of each
kind, and scored:

```
visual_norm   = clamp((cos − 0.5) / 0.5)              # 0.72 → 0.44, 0.85 → 0.70, 0.95 → 0.90
dup_norm      = clamp((v1 − 0.55) / 0.45)
combined      = min(1, 0.55·text + 0.45·max(visual_norm, dup_norm) + 0.08 if both channels agree)
```

Weights/thresholds are parameters of the function (`p_text_weight`, `p_visual_weight`,
`p_min_text`, `p_min_visual`, `p_limit ≤ 60`) and defaults of `HYBRID_DEFAULTS` in
`web/src/services/vision_service.ts`, so they can be tuned without a schema change. Each row returns
`text_score`, `visual_score` (plus `visual_raw`, `duplicate_score`), `combined_score`
**separately**, the raw `match_types` (`text_exact`, `text_fuzzy`, `phonetic`, `variant`,
`ocr_text`, `near_duplicate`, `visual_high`, `visual`) and a `reasons` object (which term matched
which field with which rule and score, the visual similarity and image, whether a class filter was
applied). The UI groups and filters by the strongest type:

| Group label | Condition |
|---|---|
| Text match | a recognised word matched exactly / as a whole word (`text_exact`), or the stored image's OCR text matched directly |
| Possible spelling or transliteration variant | the match is fuzzy, phonetic, or came from a transliteration variant |
| Visually similar | no text match; cosine ≥ 0.85 or near-duplicate |
| Similar symbol or composition | no text match; 0.72 ≤ cosine < 0.85 |

Reasons shown on the card: *Same recognised wording* / *Similar recognised wording* / *Wording sounds
alike* / *Possible spelling or transliteration variant* (with *term ↔ matched* when they differ), *Matched the text recognised in
the stored image*, *Near-identical image*, *High visual similarity*, *Similar symbol or layout*,
*Matching trademark class* (when a class filter was applied).
Filters (classes, gazette, application type) are applied **inside** the function before ranking.
Scores are labelled as computational indicators, never as a likelihood of confusion.

## 3. Indexing the existing images

`trademark_image_analysis` has one row per `trademark_images.id` (FK cascade, so deleting an image
deletes its analysis), with `trademark_id`, `model_version`, `status` (`indexed` | `failed`),
`ocr_text`, generated `ocr_text_normalized`, `ocr_confidence`, `ocr_words` (boxes + confidence),
`ocr_scripts`, `embedding`, `warnings`, `error`, `duration_ms`, `attempts`, `indexed_at`.

Batches are **resumable and idempotent**: `admin_image_analysis_pending(p_model, p_limit ≤ 500,
p_retry_failed)` returns matched images that have no row for the current model (never-analysed
first, then failed ones with fewer than 5 attempts when retrying), in storage-path order; the
service downloads each file from the public bucket URL
(`storage_path`), analyses it in memory and stores results with `admin_upsert_image_analysis`
(≤ 200 items per call, `attempts` incremented, invalid items rejected without touching the others).
Failures are stored with their message (404, undecodable, timeout) and listed in the admin panel
(downloadable CSV). Only one run per service instance at a time (`409 busy`). Nothing is ever
deleted and the images themselves are untouched.

The admin panel (`AnalysisIndexPanel`) shows matched / analysed / with text / pending / failed, the
model versions present, the last run, and offers *Analyse next N* (25 / 100 / 300) and *Retry
failed*. Both go through the service with the administrator's **own** access token; the database
re-checks `admin_assert()`, so the service holds no privileged key.

## 4. Environment variables

| Where | Variable | Value |
|---|---|---|
| static site (build) | `VISION_API_URL` | `https://tmistan-vision.onrender.com` — empty = basic mode (also `VITE_VISION_API_URL`) |
| local dev | `VISION_API_URL=/vision` (+ optional `VISION_PROXY_TARGET`, default `http://127.0.0.1:8000`) | Vite proxies `/vision` to the local service |
| vision service | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `ALLOWED_ORIGINS`, `RATE_LIMIT_PER_MINUTE` (20), `MAX_UPLOAD_MB` (8), `ORT_THREADS` (2), OCR/CLIP tuning | see `services/vision/README.md` |

No secret is needed anywhere for this feature. The service never sees the service-role key in the
default deployment.

## 5. Measured results (real registry images)

Evaluation harness: `services/vision/eval/evaluate.py`, run against the local stack seeded with
**48 real production images** (gazette 1027: Latin, Persian/Pashto and bilingual marks, devices,
one black-rectangle scan) through the complete path (service → `search_trademarks_hybrid`,
`p_limit = 10`). "top-k" = the trademark the query was derived from appears in the first k results.

| Query category (how it was built) | n | top-1 | top-3 | top-5 | OCR found text | median analyse |
|---|---|---|---|---|---|---|
| exact file re-uploaded | 48 | 46 (96 %) | 48 | 48 | 34 | 0.45 s |
| transformed (JPEG q35, ⅓ scale, padded, inverted, tinted…) | 192 | 159 (83 %) | 183 (95 %) | 192 (100 %) | 144 | 0.46 s |
| low quality (blur + noise + heavy JPEG) | 48 | 28 (58 %) | 36 (75 %) | 39 (81 %) | 24 | 0.63 s |
| same word rendered in other fonts (serif / sans / mono / bold-italic / Noto Naskh) | 135 | 111 (82 %) | 129 (96 %) | 135 (100 %) | 135 | 0.36 s |
| misspellings (letter swap / drop / double, NOOR→NOUR style) | 45 | 33 (73 %) | 40 (89 %) | 44 (98 %) | 43 | 0.36 s |
| cross-script: Persian/Pashto word of a bilingual mark rendered alone (Naskh + Kufi) | 26 | 14 (54 %) | 18 (69 %) | 20 (77 %) | 20 | 0.46 s |
| Latin transliteration of a Persian-only mark | 2 | 0 | 0 | 0 | 1 | — |
| symbol-only crop (text removed) | 10 | 10 | 10 | 10 | 3 | 0.45 s |
| blank sheet | 1 | rejected with *"image appears to be blank"* | | | | 4 ms |
| random noise | 1 | no meaningful match, flagged uncertain | | | | 8.9 s (OCR budget) |

Search RPC latency: 4–15 ms median per category (48-image index; HNSW + GIN scale sub-linearly).
Indexing throughput on this sandbox CPU: ≈ 0.6–0.9 s per image (OCR dominates); failed 0 / 48.
The two exact misses are three records that share an identical image (DELL EMC), i.e. ties.

What this does **not** show: results on the full 1,194-image corpus (expect more near-miss noise
in the *Similar symbol or composition* group), figurative marks with no text and no close
counterpart, and heavily stylised lettering where Tesseract finds nothing (34 of 48 stored images
yielded text; the rest are searched visually only). Run the harness again after the production
index is built; the report path is printed and the numbers above should be refreshed in this file.

## 6. Cost, limits, privacy

* **Models**: Tesseract (Apache-2.0) and CLIP ViT-B/32 int8 ONNX from `Xenova/clip-vit-base-patch32`
  (MIT) run on CPU inside the service — no per-call fee, no external AI API, no data leaves the
  deployment. A Render **Starter** instance (512 MB, ≈ US$ 7/month at the time of writing) is enough:
  the process uses ≈ 230 MB; analysis takes 0.4–1.5 s per query, OCR capped at 7 s.
* **Limits**: 8 MB uploads, 20 analyses per IP per minute (429 + `Retry-After`), 40 s hard timeout,
  ≤ 60 results per search, 500 images per indexing request.
* **Privacy**: the uploaded picture is processed in memory and discarded; only recognised words and
  vectors reach the database as RPC parameters; no query is stored; logs contain sizes and timings,
  never image content or text. The table has RLS with no policies — reachable only through the
  SECURITY DEFINER functions (published rows only); admin functions call `admin_assert()`.
* **Bucket**: unchanged — public read, writes only through the existing admin policies.

## 7. Known limitations

* OCR is weakest on heavily stylised, outlined or very low-resolution lettering and on Kufi-style
  Arabic script; such marks are found visually only. The confidence pill and the editable words
  exist precisely so the visitor can correct the reading.
* Transliteration is rule-based and deliberately narrow (one or a few renderings per word); it
  cannot cover every Dari/Pashto spelling convention and is always labelled as a variant.
* CLIP similarity captures composition and shape; it can rank two unrelated wordmarks in the same
  layout as "similar symbol or composition" — the score bands and reasons make this visible.
* Results are **research candidates** ranked by computational similarity, never a legal
  determination of similarity, likelihood of confusion or infringement.

## 8. Files

`services/vision/` (FastAPI service: `app/preprocess.py`, `ocr.py`, `textnorm.py`, `embed.py`,
`analysis.py`, `indexer.py`, `supabase_client.py`, `ratelimit.py`, `main.py`, `cli.py`; `Dockerfile`;
`eval/evaluate.py`; `README.md`) ·
`supabase/migrations/20261027001200_intelligent_image_search.sql` + `supabase/APPLY_1200.sql` ·
`supabase/dev/test_1200_intelligent_image_search.sql` (31-check SQL harness for the local stack) ·
`web/src/services/vision_service.ts` (typed client: health, analyze, hybrid search, admin index) ·
`web/src/components/search/{useImageSearch.ts,ImageSearchCard.tsx,ImageSearchResults.tsx}` (shared
UI for both modes: upload → preview → recognised words → filters → grouped, filterable results) ·
`web/src/pages/admin/AnalysisIndexPanel.tsx` (admin status / batches / retry) ·
`web/vite.config.ts` (`VISION_API_URL` inlining + `/vision` dev proxy) · `render.yaml`
(`tmistan-vision` service) · i18n keys `search.image.*`, `admin.analysis.*`.

Basic mode (v1, kept as fallback and as the near-duplicate signal): `web/src/lib/imageSearch/
descriptor.ts`, `web/src/services/image_search_service.ts`, `web/src/pages/admin/ImageIndexPanel.tsx`,
`supabase/migrations/20261011000500_image_search.sql` / `APPLY_0500.sql` — a 369-number perceptual
descriptor (pHash, low-frequency DCT, stroke orientation, grey grid, ink colour, geometry) computed
in the browser and compared by cosine similarity; calibrated cut-off 0.55 (high ≥ 0.80, moderate
≥ 0.65).
