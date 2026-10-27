"""TMistan vision service — OCR + visual embeddings for intelligent trademark search.

Endpoints
  GET  /health                      liveness + model/OCR availability (public)
  POST /analyze                     multipart `image` → OCR words, variants, CLIP embedding (public, rate-limited)
  GET  /admin/index/status          index counts (requires an administrator's Supabase access token)
  POST /admin/index/run             index the next batch of stored images (same token)

The service never stores uploaded images, never logs their content and holds
no privileged database key: the administrator's own token is forwarded to the
database functions, which enforce the role server-side.
"""
from __future__ import annotations

import asyncio
import logging
import os
import threading
import time

from fastapi import FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import embed as clip
from . import indexer, ocr
from .analysis import MAX_UPLOAD_BYTES, analyze
from .preprocess import ImageError
from .ratelimit import RateLimiter
from .supabase_client import RpcError, Supabase

log = logging.getLogger("tmistan.vision")
logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s %(message)s")

SERVICE_VERSION = "1.0.0"
ANALYZE_TIMEOUT_S = float(os.environ.get("ANALYZE_TIMEOUT_SECONDS", "40"))
INDEX_LOCK = threading.Lock()
STARTED = time.time()

app = FastAPI(title="TMistan vision service", version=SERVICE_VERSION, docs_url=None, redoc_url=None)
origins = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["*"], max_age=600)
limiter = RateLimiter(per_minute=int(os.environ.get("RATE_LIMIT_PER_MINUTE", "20")), burst=int(os.environ.get("RATE_LIMIT_BURST", "10")))
sb = Supabase()


@app.on_event("startup")
def _warm() -> None:
    if os.environ.get("CLIP_PRELOAD", "1") == "1":
        threading.Thread(target=_safe_load, name="clip-preload", daemon=True).start()


def _safe_load() -> None:
    try:
        clip.session()
        log.info("CLIP model loaded (%s)", clip.MODEL_VERSION)
    except Exception as e:  # reported through /health
        log.error("CLIP model unavailable: %s", e)


def _client_ip(req: Request) -> str:
    fwd = req.headers.get("x-forwarded-for")
    return (fwd.split(",")[0].strip() if fwd else (req.client.host if req.client else "unknown"))


@app.get("/health")
def health() -> dict:
    ok, ver, langs = ocr.available()
    return {
        "ok": True,
        "service": "tmistan-vision",
        "version": SERVICE_VERSION,
        "uptime_s": int(time.time() - STARTED),
        "ocr": {"available": ok, "tesseract": ver, "languages": [l for l in langs if l in ("eng", "fas", "pus", "ara")], "engine": ocr.OCR_VERSION},
        "embedding": {"available": clip.loaded(), "model": clip.MODEL_VERSION, "dims": clip.EMBED_DIMS, "error": clip.load_error()},
        "limits": {"max_upload_bytes": MAX_UPLOAD_BYTES, "rate_limit_per_minute": limiter.per_minute},
        "supabase_configured": sb.configured,
    }


@app.post("/analyze")
async def analyze_endpoint(request: Request, image: UploadFile = File(...), ocr_enabled: bool = True, embedding_enabled: bool = True):
    if not limiter.allow(_client_ip(request)):
        raise HTTPException(status_code=429, detail={"code": "rate_limited", "message": "Too many image analyses from this address. Please wait a minute."},
                            headers={"Retry-After": "20"})
    data = await image.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail={"code": "too_large", "message": f"Images up to {MAX_UPLOAD_BYTES // (1024 * 1024)} MB are accepted."})
    try:
        result = await asyncio.wait_for(asyncio.to_thread(analyze, data, want_ocr=ocr_enabled, want_embedding=embedding_enabled), timeout=ANALYZE_TIMEOUT_S)
    except ImageError as e:
        raise HTTPException(status_code=400, detail={"code": e.code, "message": str(e)})
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail={"code": "timeout", "message": "Image analysis took too long. Try a smaller or clearer image."})
    log.info("analyze %s %sx%s ocr_words=%s emb=%s %sms", result["image"]["format"], result["image"]["width"], result["image"]["height"],
             len((result.get("ocr") or {}).get("words") or []), result.get("embedding") is not None, result["timings_ms"].get("total"))
    return result


class IndexRunBody(BaseModel):
    limit: int = Field(default=100, ge=1, le=500)
    retry_failed: bool = False


def _bearer(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "An administrator access token is required."})
    return authorization.split(" ", 1)[1].strip()


def _rpc_http(e: RpcError) -> HTTPException:
    status = 403 if e.code == "42501" or e.status in (401, 403) else (503 if e.code == "PGRST202" else 502)
    msg = "Migration 1200 (intelligent image search) has not been applied to the Supabase project." if e.code == "PGRST202" else str(e)
    return HTTPException(status_code=status, detail={"code": e.code or "rpc_error", "message": msg})


@app.get("/admin/index/status")
def index_status(authorization: str | None = Header(default=None)):
    try:
        return sb.rpc("admin_image_analysis_status", {"p_model": indexer.model_version()}, _bearer(authorization))
    except RpcError as e:
        raise _rpc_http(e)


@app.post("/admin/index/run")
async def index_run(body: IndexRunBody, authorization: str | None = Header(default=None)):
    token = _bearer(authorization)
    if not INDEX_LOCK.acquire(blocking=False):
        raise HTTPException(status_code=409, detail={"code": "busy", "message": "An indexing batch is already running."})
    try:
        return await asyncio.to_thread(indexer.run_batch, sb, token, limit=body.limit, retry_failed=body.retry_failed)
    except RpcError as e:
        raise _rpc_http(e)
    finally:
        INDEX_LOCK.release()


@app.exception_handler(HTTPException)
async def _http_exc(_: Request, exc: HTTPException):
    detail = exc.detail if isinstance(exc.detail, dict) else {"code": "error", "message": str(exc.detail)}
    return JSONResponse(status_code=exc.status_code, content={"error": detail}, headers=getattr(exc, "headers", None) or None)
