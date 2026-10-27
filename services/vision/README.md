# TMistan vision service

Small Python API behind the **intelligent "Search by Image"** (see `docs/IMAGE_SEARCH.md`):

* **OCR** — Tesseract 5 with `eng` + `fas` + `pus` (Latin and Arabic-script words), adaptive
  passes (normal → inverted → sparse), per-word confidence, Unicode normalisation, script
  detection; uncertain readings are flagged, never silently trusted.
* **Transliteration variants** — conservative Latin ↔ Arabic/Persian candidate spellings
  (`app/textnorm.py`), returned separately and labelled, weighted down by the database ranking.
* **Visual embedding** — CLIP ViT-B/32 vision tower, int8 ONNX (`Xenova/clip-vit-base-patch32`,
  MIT), 512-d unit vectors, ~50 ms per image on one CPU core, ~230 MB RSS.
* **Indexing** — resumable, idempotent batches over the stored trademark images, through the
  migration-1200 RPCs (`admin_image_analysis_pending` → analyse → `admin_upsert_image_analysis`).

Only open models run here; no third-party AI API is called and no image is written to disk.
The image of a query lives in memory for the duration of the request and is not logged.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/health` | – | `ok`, Tesseract version + languages, model name, limits. The web app only calls the service "available" when this answers `ok: true`. |
| `POST` | `/analyze` | – (rate-limited per IP) | multipart `image` (≤ `MAX_UPLOAD_MB`). Query flags `ocr_enabled`, `embedding_enabled`. Returns `image{width,height,format,blank,content_box}`, `ocr{text,confidence,scripts,uncertain,words[],passes,duration_ms,engine,error}`, `variants[]`, `embedding[512]`, `models{ocr,embedding}`, `warnings[]`, `timings_ms`. |
| `GET` | `/admin/index/status` | `Authorization: Bearer <admin Supabase access token>` | result of `admin_image_analysis_status` (totals, indexed, with text, failed, pending, failures). |
| `POST` | `/admin/index/run` | same | `{ "limit": ≤500, "retry_failed": bool }` — analyses the next pending images and stores them; returns `{attempted, indexed, failed, ocr_with_text, failures[], duration_ms}`. One run at a time (`409 busy`). |

Errors are always `{ "error": { "code", "message" } }`: `400 empty|too_large|unsupported|corrupt|too_small`,
`413 too_large`, `429 rate_limited` (with `Retry-After`), `504 timeout`, `401/403` for admin
calls, `503` with *"Migration 1200 … not applied"* when the database lacks the RPCs.

The admin endpoints forward the **administrator's own token** to Supabase, so the database still
enforces `admin_assert()`; the service itself holds no privileged key in the default deployment.
(`python -m app.cli index --all` / `python -m app.cli status` can alternatively run from an operator machine with
`SUPABASE_SERVICE_ROLE_KEY` **or** `SUPABASE_ADMIN_TOKEN` = an administrator's access token — never put either in the web app.)

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `SUPABASE_URL` | – | `https://<ref>.supabase.co` (REST + public Storage URLs are derived from it) |
| `SUPABASE_PUBLISHABLE_KEY` | – | public key used as `apikey` for the RPC calls |
| `ALLOWED_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | comma-separated browser origins allowed by CORS — set to the static-site origin(s) in production (e.g. `https://www.tmistan.com,https://tmistan.onrender.com`) |
| `MAX_UPLOAD_MB` | `8` | upload size limit |
| `RATE_LIMIT_PER_MINUTE`, `RATE_LIMIT_BURST` | `20`, `10` | `/analyze` calls per client IP per minute, and the burst allowance (token bucket) |
| `ANALYZE_TIMEOUT_SECONDS` | `40` | hard cap for one analysis |
| `OCR_BUDGET_SECONDS` / `OCR_TIMEOUT_SECONDS` | `7` / `8` | no new OCR pass after the budget; per-pass Tesseract timeout |
| `OCR_MIN_WORD_CONF` | `55` | words below this confidence are dropped |
| `OCR_LATIN_LANG`, `OCR_ARABIC_LANG` | `eng`, `fas+pus` | Tesseract language packs used by the two passes |
| `LOG_LEVEL` | `INFO` | log verbosity (requests are logged without image content) |
| `CLIP_MODEL_PATH` | `/app/models/clip-vit-b32-vision-q8.onnx` | baked into the Docker image; `CLIP_MODEL_URL` + `CLIP_DOWNLOAD=1` fetch it on start instead |
| `CLIP_PRELOAD` | `1` | load the model at start-up (otherwise on first use) |
| `ORT_THREADS` | `2` | onnxruntime intra-op threads |
| `SUPABASE_REST_URL`, `STORAGE_PUBLIC_BASE` | derived | overrides for the local stack (PostgREST at the root, storage stub) |
| `PORT` | `8000` | injected by Render |

## Run locally

```bash
sudo apt-get install tesseract-ocr tesseract-ocr-eng tesseract-ocr-fas tesseract-ocr-pus
cd services/vision
python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
mkdir -p models && curl -L -o models/clip-vit-b32-vision-q8.onnx \
  https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/vision_model_quantized.onnx
export CLIP_MODEL_PATH=$PWD/models/clip-vit-b32-vision-q8.onnx
export SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_REST_URL=http://127.0.0.1:54321 \
       STORAGE_PUBLIC_BASE=http://127.0.0.1:54322/object/public SUPABASE_PUBLISHABLE_KEY=<LOCAL_ANON_KEY>   # local stack
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Then `VISION_API_URL=/vision npm run dev` in `web/` (the dev server proxies `/vision` → `:8000`).
Against the real project use `SUPABASE_URL=https://<ref>.supabase.co` and the publishable key.

Docker: `docker build -t tmistan-vision services/vision && docker run -p 8000:8000 -e SUPABASE_URL=… -e SUPABASE_PUBLISHABLE_KEY=… -e ALLOWED_ORIGINS=https://www.tmistan.com tmistan-vision`.

## Evaluation

`eval/evaluate.py` runs the complete production path (service `/analyze` → PostgREST
`search_trademarks_hybrid`) for a folder of real registry images + `meta.json`
(`[{file, serial, gazette, mark_name}]`), generating the query categories listed in the file
(exact, transformed, low quality, other fonts, misspellings, cross-script, symbol-only, blank,
noise) and printing top-1/3/5 hit rates, OCR success and latency per category:

```bash
VISION_API_URL=http://127.0.0.1:8000 SUPABASE_URL=… SUPABASE_PUBLISHABLE_KEY=… \
python3 eval/evaluate.py --sample /path/to/sample --out report.json [--only cross_script,spelling]
```

Measured results are recorded in `docs/IMAGE_SEARCH.md` (section *Measured results*).
