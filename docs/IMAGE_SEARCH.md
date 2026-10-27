# Search by Image

`/?mode=image` (the *Search by Image* mode of the landing page) lets a visitor drop a logo / mark
image and get the published trademarks that are **textually, visually or phonetically comparable**.
It is a *research aid* for finding candidate marks — it is not a clearance, availability or
infringement opinion, and the UI says so on every result list.

**Monthly cost of the feature: $0.** Everything runs in the visitor's browser (text recognition), on
the administrator's own machine or browser (indexing), and inside the existing Supabase project
(index + ranking). There is no inference service, no `VISION_API_URL`, no third-party AI API.

Two modes share the same UI and the same result cards:

| Mode | When | What it compares |
|---|---|---|
| **Intelligent** — *Text + near-duplicate search* | migrations **1200 + 1300** applied **and** at least one stored image analysed **and** the browser can run the recogniser | words recognised in the uploaded image (Tesseract.js in a Web Worker, Latin + Arabic script) ↔ mark names, printed mark text and the words recognised in every stored image; spelling + phonetic + transliteration variants; the v1 near-duplicate descriptor of the picture ↔ stored descriptors |
| **Basic** (fallback, = the v1 implementation, migration 0500) | otherwise — and always for symbol-only images | the 369-number perceptual descriptor computed in the browser (near-identical images only) |

The page detects the mode at load time (`hybrid_image_search_status` + a browser capability check),
explains it in the card and degrades automatically: migration missing → basic mode with the exact
reason; empty index → basic mode; browser without WebAssembly/Workers → basic mode; data-saver
connection → the ≈ 8 MB recogniser is not downloaded until the visitor presses *Load text
recognition*; recogniser failed to start → basic mode and a retry button; no readable words → the
near-duplicate channel alone, and the results say so (*"No readable text — only the near-duplicate
check and visual similarity were used"*). Intelligent mode is never announced unless migration,
index and query path are all actually ready.

```
visitor's browser (static site, Render free tier)                        Supabase (Postgres + pgvector, existing project)
┌───────────────────────────────────────────────────────┐                ┌─────────────────────────────────────────────┐
│ image (≤ 8 MB) → preview, never uploaded              │                │ trademarks (mark_name, mark_print, …)       │
│ Tesseract.js worker (self-hosted /ocr/*, cached in    │                │ trademark_image_analysis (RLS, no policies) │
│   IndexedDB after the first use): eng + fas+pus,      │                │   ocr_text, ocr_text_normalized, ocr_words, │
│   per-word confidence, uncertain flag, time budget    │                │   status indexed|skipped|failed, model,     │
│ transliteration / spelling variants (textnorm.ts)     │                │   attempts · GIN trigram index              │
│ v1 descriptor (descriptor.ts) → 369 numbers           │                │ trademark_image_features (v1 descriptors)   │
│ visitor edits the recognised words                    │ rpc            │                                             │
│  → search_trademarks_hybrid(terms, variants,          │ ─────────────▶ │ search_trademarks_hybrid()  SECURITY DEFINER│
│    descriptor, filters)                               │ ◀───────────── │   published rows only · text + duplicate    │
│  ranked rows with match_types, scores and reasons     │                │   channels merged per trademark · cap 60    │
└───────────────────────────────────────────────────────┘                └─────────────────────────────────────────────┘
Indexing the stored images (administrator, $0):
  Import Center → "Text recognised in trademark images" (same Tesseract.js pipeline, in the admin's browser)   — or —
  tools/image_index on a PC / Codespace (native Tesseract, same models, 10–20 min for the archive)
  both: admin_image_analysis_pending() → download public object → OCR → admin_upsert_image_analysis()  (admin_assert in the DB)
```

## 1. One-time setup (project owner)

1. **Database** — Supabase → SQL Editor → paste **`supabase/APPLY_1300.sql`** → Run (it contains
   migrations 1200 and 1300; `APPLY_ALL.sql` on a fresh project). Additive and idempotent: enables
   `pg_trgm` + `fuzzystrmatch` (`vector` already from 0500), adds table
   `public.trademark_image_analysis`, helpers `phonetic_key` / `text_match`, the public functions
   `search_trademarks_hybrid` / `hybrid_image_search_status` and the admin functions
   `admin_image_analysis_status` / `admin_image_analysis_pending` / `admin_upsert_image_analysis`;
   1300 adds the `skipped` status (image analysed, nothing readable), `engine`, `p_include_skipped`
   and the coverage counters. No existing table or row is modified; the frontend works unchanged
   while the migrations are not applied (it shows basic mode and, in the Import Center, which
   file to paste).
2. **Deploy the static site** (normal push → Render builds `web/`). Nothing to configure: the
   recogniser (`tesseract.js` core + `web/public/ocr/tessdata/*.traineddata.gz`) is part of the
   site. `render.yaml` only gained a cache header for `/ocr/*`. Remove the old `VISION_API_URL`
   variable from the Render static site if it was ever set (it is ignored), and delete the
   `tmistan-vision` web service if it was created — it is no longer part of the blueprint.
3. **Index a small sample first** — sign in → **Admin → Import Center → Text recognised in
   trademark images** → batch size **25** → *Analyse next 25 images* (the admin's browser downloads
   the recogniser once, ≈ 8 MB, then ≈ 2–5 s per image). Check the counts (with text / no readable
   text / failed), open the public page and try a few of those marks (a photo of the logo, the word
   in another font, the Persian spelling).
4. **Index everything** — either keep pressing *Analyse next 100/300* in the panel (keep the tab
   open; ≈ 1 hour for 1,194 images on a laptop; stopping is safe and resumable), or run the offline
   indexer once: `python -m tools.image_index --login <admin e-mail> index --all`
   (`tools/image_index/README.md`; Windows, macOS, Linux or a free GitHub Codespace; 10–20 minutes).
   The PC does not need to stay online afterwards.
5. **Later** — images uploaded through the Import Center appear as *Pending* until the next batch
   is run (the panel says so). After a model change (`OCR_MODEL_VERSION` bump in
   `web/src/lib/imageSearch/ocr.ts` **and** `tools/image_index/version.py`) all images become
   pending for the new version while the old rows keep serving searches until replaced.

## 2. How a query is processed

### 2.1 Preprocessing (`web/src/lib/imageSearch/preprocess.ts`, Python twin `tools/image_index/preprocess.py`)
Decoded in the browser (`createImageBitmap`, EXIF orientation honoured; type/size validated as
before: PNG/JPEG/WEBP/GIF/BMP, ≤ 8 MB), transparency flattened on white, working size ≤ 2048 px,
border background estimate + content-box crop (so a logo on a white sheet and the same logo tightly
cropped read alike), blank detection (grey-level standard deviation < 4 → *"image appears to be
blank"*). OCR renditions: grayscale, 1 % autocontrast, upscaled so letters are ≈ 30 px (capped at
1600 px), 24 px border; a second, inverted rendition for light-on-dark marks. Originals are never
written anywhere.

### 2.2 Text recognition (`web/src/lib/imageSearch/ocr.ts`)
Tesseract.js 7 (Tesseract 5 LSTM compiled to WebAssembly, SIMD build when the CPU supports it) in
a pool of Web Workers (1 on phones / low-memory devices, 2 on desktops), self-hosted from the
static site: worker ≈ 0.1 MB, core ≈ 3 MB wasm (+ loader), language models `eng` 2.0 MB, `fas`
0.3 MB, `pus` 1.4 MB (gzip, `tessdata_fast`, Apache-2.0). Downloaded on first use and cached in
IndexedDB (`cachePath`), so the download happens once per device (≈ 8 MB; the card tells the
visitor and shows the progress). Passes: block mode (`psm 6`) on the normal rendition for `eng`
and `fas+pus`; the inverted rendition only when no confident word (≥ 75, ≥ 3 letters) was found;
sparse text (`psm 11`) only when nothing at all was found; a time budget stops further passes.
Words below confidence 55 are dropped, digits-only tokens are dropped unless they are all there is,
reading order is kept, Unicode is NFKC-normalised with Arabic presentation forms folded (ي/ی, ك/ک,
diacritics removed) while the **original text is kept** too. The result carries a confidence, the
detected scripts, per-word confidence and an `uncertain` flag (no words, or mean word confidence
below 75). The UI shows the words in an **editable field** — uncertain readings are labelled
*"Low confidence — please check"* and the visitor can correct them before searching; the words that
are actually searched are the ones in that field.

Device handling: `ocrSupport()` returns `unsupported` (no WebAssembly, Web Workers or IndexedDB) →
basic mode; `save_data` (`navigator.connection.saveData`) → opt-in button; engine
download/start failure → basic mode with a retry; `AbortController` cancels recognition when the
visitor replaces the image; `shutdownOcr()` releases the workers when the search card unmounts.

Start-up failures are detected, not waited out: Tesseract.js's `createWorker()` never settles when
a language model or the core cannot be downloaded (it only reports through `errorHandler`), so
`spawn()` races it against that handler and a 90 s no-progress watchdog. A blocked or 404'd model
therefore flips the card to basic mode within about half a second (reason *"could not be
started"*, with the technical message and a **Retry** button); Retry starts the engine again and
analyses the selected image without a page reload. The e2e test covers both the failure and the
recovery.

### 2.3 Transliteration / spelling variants (`web/src/lib/imageSearch/textnorm.ts`, Python twin `textnorm.py`)
Conservative, rule-based, and **labelled as possible variants** (never merged with the recognised
words): Latin → Arabic-script (one rendering per word: `noor` → نور, `nawid` → نوید/ناوید) and
Arabic-script → Latin with the common Afghan/Persian conventions (نور → `nor`/`nur`/`noor`/`nour`,
شائسته → `shaista`/`shaysta`/`shaeesta`). The visitor can switch them off (*"Also search N possible
spelling or transliteration variants"*); the database weights them at 0.85 and labels hits
*"Possible spelling or transliteration variant"*.

### 2.4 Text channel (`text_match` in migration 1200, runs in Postgres)
Each query term (and each variant) is compared with three fields of every published trademark:
`mark_name_normalized` (weight 1.0), normalised `mark_print` (0.95) and the recognised text of its
stored images (0.9). Score per term:

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
the merge. The GIN trigram index keeps this a candidate lookup, not a scan.

### 2.5 Visual channel (near-duplicate)
The v1 descriptor (`trademark_image_features`, migration 0500: pHash + low-frequency DCT + stroke
orientation + grey grid + ink colour + geometry, 369 numbers, cosine) is queried with the picture's
own descriptor (80 nearest) and acts as a **near-duplicate detector** (`≥ 0.67` on its normalised
scale; `exact` option raises the bar to 0.95). It recognises the same image re-encoded, rescaled,
padded, inverted, tinted or moderately compressed. **It is not a semantic visual model**: it does
not know that two different drawings of a lion are both lions. The `embedding` column of
`trademark_image_analysis` stays in place (NULL) so a free embedding source can be added later
without a schema change — see §7 for why none ships today.

### 2.6 Combined ranking (`search_trademarks_hybrid`)
Candidates from all channels are merged **per trademark id**, keeping the strongest evidence of each
kind, and scored:

```
dup_norm      = clamp((v1 − 0.55) / 0.45)
combined      = min(1, 0.55·text + 0.45·dup_norm + 0.08 if both channels agree)
```

Weights/thresholds are parameters of the function (`p_text_weight`, `p_visual_weight`,
`p_min_text`, `p_min_visual`, `p_limit ≤ 60`) and defaults of `HYBRID_DEFAULTS` in
`web/src/services/image_analysis_service.ts`, so they can be tuned without a schema change. The
client always passes `p_model` (the model version it knows), so rows of another version are
ignored. Each row returns `text_score`, `visual_score`, `duplicate_score`, `combined_score`
**separately**, the raw `match_types` (`text_exact`, `text_fuzzy`, `phonetic`, `variant`,
`ocr_text`, `near_duplicate`, `visual_high`, `visual`) and a `reasons` object (which term matched
which field with which rule and score, the visual similarity and image, whether a class filter was
applied). The UI groups and filters by the strongest type:

| Group label | Condition |
|---|---|
| Text match | a recognised word matched exactly / as a whole word (`text_exact`), or the stored image's recognised text matched directly |
| Possible spelling or transliteration variant | the match is fuzzy, phonetic, or came from a transliteration variant |
| Visually similar | no text match; near-duplicate |
| Similar symbol or composition | no text match; weaker descriptor similarity |

Scores are labelled as computational indicators, never as a likelihood of confusion. Filters
(classes, gazette, application type) are applied **inside** the function before ranking.

## 3. Indexing the existing images

`trademark_image_analysis` has one row per `trademark_images.id` (FK cascade), with
`trademark_id`, `model_version`, `status` (`indexed` | `skipped` | `failed`), `ocr_text`,
generated `ocr_text_normalized`, `ocr_confidence`, `ocr_words`, `ocr_scripts`, `warnings`, `error`,
`engine` (`tesseract.js@7.0.0` or `tesseract-native`), `duration_ms`, `attempts`, `indexed_at`.
`skipped` means *analysed, nothing readable* — such images count as covered, stay searchable by
the near-duplicate channel, and can be re-analysed (`Re-analyse skipped` / `--include-skipped`).

Batches are **resumable and idempotent**: `admin_image_analysis_pending(p_model, p_limit ≤ 500,
p_retry_failed, p_include_skipped)` returns matched images that have no row for the current model
(never-analysed first, then failed ones with fewer than 5 attempts when retrying, then skipped ones
when asked), in storage-path order; the indexer downloads each file from the public bucket URL,
analyses it in memory and stores results with `admin_upsert_image_analysis` (≤ 200 items per
call, `attempts` incremented, invalid items rejected without touching the others). Failures are
stored with their message (404, undecodable, timeout) and listed in the admin panel (downloadable
CSV). Nothing is ever deleted and the images themselves are untouched.

Two interchangeable indexers:

| | Import Center panel (`AnalysisIndexPanel.tsx` + `lib/imageSearch/indexer.ts`) | `tools/image_index` (Python) |
|---|---|---|
| runs | in the administrator's browser tab | on a PC / GitHub Codespace |
| engine | Tesseract.js (same as visitors) | native Tesseract 5, same `tessdata_fast` models |
| speed | ≈ 2–5 s per image (2 workers) | ≈ 0.3–1 s per image per worker |
| needs | the tab open during the batch (results saved every 25 images; Stop is safe) | Python + Tesseract installed once; Ctrl-C safe |
| auth | the admin's Supabase session | the admin's e-mail + password (publishable key) or the service key on a trusted machine |

The panel shows matched / with text / no readable text / pending / failed, a coverage bar, the
engine download progress, per-image progress with ETA, *Analyse next N* (25 / 100 / 300),
*Retry failed*, *Re-analyse skipped*, *Stop*, the last analysis time, rows of other model versions,
and explicit states for *migrations not applied* (which file to paste), *not an administrator*,
*browser cannot run the recogniser* (use the offline tool).

## 4. Environment variables

None for this feature. The web build still needs only `SUPABASE_URL` and
`SUPABASE_PUBLISHABLE_KEY` (public). **Removable**: `VISION_API_URL` / `VITE_VISION_API_URL` /
`VISION_PROXY_TARGET` (ignored now) and the whole `tmistan-vision` Render service with its
`ALLOWED_ORIGINS`, `RATE_LIMIT_PER_MINUTE`, `MAX_UPLOAD_MB`, `ORT_THREADS`.
`tools/image_index` reads `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY` from `web/.env.local` and
optionally `SUPABASE_SERVICE_ROLE_KEY` from `importers/.env` (`--service-key`).

## 5. Measured results (real registry images)

Evaluation harness: `tools/image_index/evaluate.py` — it drives the **real browser path**
(Chromium via Playwright → `analyseImage()` with Tesseract.js → `describeImage()` →
`search_trademarks_hybrid` / `search_trademarks_by_image`, `p_limit = 10`) against the local stack
seeded with **48 real production images** (gazettes 1011/1027/1042/1411…: Latin, Persian/Pashto
and bilingual marks, devices, one black-rectangle scan) whose words were indexed with
`tools/image_index` (native Tesseract) — i.e. the production configuration: native-indexed rows,
browser-recognised queries. "top-k" = the trademark the query was derived from appears in the
first k results.

| Query category (how it was built) | n | top-1 | top-3 | top-5 | OCR found text | median recognise | paid design top-1 / top-5 |
|---|---|---|---|---|---|---|---|
| exact file re-uploaded | 48 | 45 (94 %) | 48 | 48 | 39 | 0.35 s | 46 / 48 |
| transformed (JPEG q20 · ⅓ scale + blur · inverted · tinted) | 192 | 158 (82 %) | 172 (90 %) | 172 (90 %) | 150 | 0.31 s | 159 / 192 |
| — of which JPEG q20 / ⅓ blur / tinted | 144 | 133 (92 %) | | 143 (99 %) | | | |
| — of which inverted | 48 | 25 (52 %) | | 29 (60 %) | | | |
| low quality (¼ scale + noise + JPEG q15) | 48 | 30 (63 %) | 35 (73 %) | 36 (75 %) | 31 | 0.34 s | 28 / 39 |
| same word rendered in other fonts (serif / mono / oblique) | 135 | 111 (82 %) | 129 (96 %) | 135 (100 %) | 135 | 0.18 s | 111 / 135 |
| misspellings (letter swap / drop / double, NOOR→NOUR style) | 45 | 33 (73 %) | 38 (84 %) | 42 (93 %) | 44 | 0.22 s | 33 / 44 |
| cross-script: Persian/Pashto word of a bilingual mark rendered alone (Naskh + Kufi) | 26 | 16 (62 %) | 18 (69 %) | 18 (69 %) | 22 | 0.27 s | 14 / 20 |
| Latin transliteration of a Persian-only mark | 2 | 1 | 1 | 1 | 1 | 0.22 s | 0 / 0 |
| symbol-only marks (device / no text) | 10 | 10 | 10 | 10 | 4 | 0.30 s | 10 / 10 |
| blank sheet | 1 | flagged blank, no search | | | | 4 ms | same |
| random noise | 1 | garbage words flagged *uncertain*; 3 weak "possible variant" rows (score 0.26) | | | | 9.4 s (time budget) | same |

Reading the table: the **text categories are equal to the paid design** (same ranking function,
same Tesseract family; the browser engine even read a few more images). The one real loss is
**inverted copies** of marks whose lettering Tesseract cannot read (29/48 in the top 5 instead of
48/48): CLIP tolerated inversion, the v1 near-duplicate descriptor does not, and nothing else is
left for text-free marks. The three exact-match "misses" are ties: records that share an identical
image (DELL EMC ×3, STARZPLAY ×2) all score 1.0.

Previous measurement (paid design: server OCR + CLIP embeddings, same harness categories, `docs`
of commit `cc6022a`): exact 46/48 top-1; transformed 159/192 top-1, 192/192 top-5; low quality
28/48 top-1; other fonts 111/135 top-1; spelling 33/45 top-1; cross-script 14/26 top-1;
symbol-only 10/10. The text categories are expected to be close (same ranking function, same
Tesseract family); the visual categories lose CLIP's tolerance to heavy degradation and gain
nothing — see §7 for the honest gap.

Search RPC latency: median 20 ms, p90 36 ms, max 71 ms per query (48-image index; GIN + pgvector scale sub-linearly). Browser recognition: median 0.26 s, p90 0.59 s, max 2.5 s per real mark with two workers
(after the one-time model download; a 2019 laptop CPU). Indexing throughput: native Tesseract
≈ 0.3–1 s per image per worker (48 images in 7 s with 2 workers); browser indexer ≈ 2–5 s per image.
Native Tesseract and Tesseract.js found text in the same 34 of 48 stored images.

What this does **not** show: results on the full 1,194-image corpus (expect more near-miss noise
in the *Possible variant* group), figurative marks with no text and no close counterpart, and
heavily stylised lettering where Tesseract finds nothing (14 of 48 stored images; they are searched
visually only). Run the harness again after the production index is built and refresh this table.

## 6. Cost, limits, privacy

* **Cost**: $0/month. Static site on Render's free tier (the ≈ 8 MB recogniser is served from the
  site: 100 GB/month bandwidth covers > 10,000 first-time visitors), Supabase free/existing plan
  (the text index for 1,194 images is < 2 MB; the trigram index a few MB; each search is one RPC of
  5–70 ms). Indexing uses the administrator's own computer or the free GitHub Codespaces quota
  (120 core-hours/month; a full run uses < 1 hour).
* **Limits**: 8 MB uploads; ≤ 12 words per query; ≤ 60 results per search; 500 images per indexing
  request; recognition time budget 15 s in the browser (noise/photos hit it; real marks take
  0.2–2 s). No rate limits — there is no server to protect; Supabase's own API limits apply.
* **Privacy**: the uploaded picture never leaves the browser; only the words the visitor confirms
  and a 369-number descriptor reach the database as RPC parameters; no query is stored. The stored
  images are downloaded for indexing from the public bucket by the administrator's own browser or
  PC — no third-party AI service ever receives an image. The table has RLS with no policies —
  reachable only through the SECURITY DEFINER functions (published rows only); admin functions call
  `admin_assert()`; the service-role key is never used by the web app.
* **Bucket**: unchanged — public read, writes only through the existing admin policies.

## 7. Known limitations (what the $0 design does and does not do)

* **No semantic visual similarity.** The paid design's CLIP embedding (two different pictures of a
  lion → similar) is gone. The visual channel is a near-duplicate detector of the *same* picture.
  Benchmark on the 48 real images (`bench_embed.py`, python ONNX Runtime): the small open models
  that could run in a browser (ResNet-18 q8 11 MB, DINOv2-small q8 22 MB) separated unrelated
  marks poorly (99th-percentile similarity between unrelated marks 0.94 vs. 0.79 for CLIP) and
  still cost 23–34 MB per visitor with ONNX Runtime Web; CLIP ViT-B/32 int8 (89 MB) is too heavy
  for visitors on mobile data. Supabase Edge Functions (2 s CPU / 256 MB / 20 MB bundle) cannot
  host it either, and Render's free web service spins down after 15 minutes and offers 0.1 CPU.
  **Paid alternative, if ever wanted**: one Render `0.5c-512mb` instance (≈ US$ 7/month) running
  the previous `services/vision` code (commit `09dfabb`) would restore CLIP similarity; a
  usage-based vision API would additionally send trademark images to a third party. Neither is
  enabled; both need explicit approval.
* OCR is weakest on heavily stylised, outlined or very low-resolution lettering and on Kufi-style
  Arabic script; such marks are found by the near-duplicate channel only. The confidence pill and
  the editable words exist precisely so the visitor can correct the reading.
* Tesseract.js is slower than native Tesseract (≈ 0.2–2 s per real mark on a laptop, several
  seconds on a low-end phone) and needs the one-time ≈ 8 MB download; unsupported or data-saver
  browsers fall back to basic mode automatically.
* Transliteration is rule-based and deliberately narrow (one or a few renderings per word); it
  cannot cover every Dari/Pashto spelling convention and is always labelled as a possible variant.
* Results are **research candidates** ranked by computational similarity, never a legal
  determination of similarity, likelihood of confusion or infringement.

## 8. Files

Browser pipeline: `web/src/lib/imageSearch/{preprocess,ocr,textnorm,analyze,indexer}.ts` ·
`web/public/ocr/tessdata/` (language models + README) · `web/src/services/image_analysis_service.ts`
(typed RPC client: hybrid search/status, admin status/pending/upsert) ·
`web/src/components/search/{useImageSearch.ts,ImageSearchCard.tsx,ImageSearchResults.tsx}` (shared
UI for both modes: upload → preview → recognised words → filters → grouped, filterable results) ·
`web/src/pages/admin/AnalysisIndexPanel.tsx` (admin status / batches / retry / stop) · i18n keys
`search.image.*`, `admin.analysis.*` · `render.yaml` (`/ocr/*` cache header).

Database: `supabase/migrations/20261027001200_intelligent_image_search.sql` +
`20261028001300_image_analysis_zero_cost.sql` · `supabase/APPLY_1300.sql` (both, for projects on
0100–0600) · harnesses `supabase/dev/test_1200_*.sql` (31 checks) and `test_1300_*.sql` (29).

Offline indexer + evaluation: `tools/image_index/` (`__main__.py` CLI, `ocr.py`, `preprocess.py`,
`textnorm.py`, `supabase_client.py`, `version.py`, `evaluate.py`, `README.md`).

Basic mode (v1, kept as fallback and as the near-duplicate signal): `web/src/lib/imageSearch/
descriptor.ts`, `web/src/services/image_search_service.ts`, `web/src/pages/admin/ImageIndexPanel.tsx`,
`supabase/migrations/20261011000500_image_search.sql` / `APPLY_0500.sql` — a 369-number perceptual
descriptor computed in the browser and compared by cosine similarity; calibrated cut-off 0.55
(high ≥ 0.80, moderate ≥ 0.65).
