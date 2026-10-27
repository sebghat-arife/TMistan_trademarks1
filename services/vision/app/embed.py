"""Visual embeddings with the CLIP ViT-B/32 image encoder (ONNX, int8-quantised).

Model: openai/clip-vit-base-patch32 vision tower exported to ONNX by Xenova
(`onnx/vision_model_quantized.onnx`, ~89 MB, MIT licence). It runs on CPU with
onnxruntime in ~60 ms per image and ~220 MB RSS, which fits a 512 MB instance.
The 512-d output is L2-normalised so cosine similarity = dot product (pgvector <=>).
"""
from __future__ import annotations

import os
import threading
import time
import urllib.request
from pathlib import Path

import numpy as np

MODEL_VERSION = "clip-vit-b32-q8"
EMBED_DIMS = 512
DEFAULT_URL = "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/vision_model_quantized.onnx"

_lock = threading.Lock()
_session = None
_load_error: str | None = None


def model_path() -> Path:
    return Path(os.environ.get("CLIP_MODEL_PATH", str(Path(__file__).resolve().parent.parent / "models" / "clip-vit-b32-vision-q8.onnx")))


def ensure_model(download: bool = True) -> Path:
    p = model_path()
    if p.exists() and p.stat().st_size > 10_000_000:
        return p
    if not download:
        raise FileNotFoundError(f"CLIP model not found at {p}")
    url = os.environ.get("CLIP_MODEL_URL", DEFAULT_URL)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".part")
    urllib.request.urlretrieve(url, tmp)  # noqa: S310 - fixed, documented model URL
    tmp.replace(p)
    return p


def session():
    """Lazily create the onnxruntime session (thread-safe)."""
    global _session, _load_error
    if _session is not None:
        return _session
    with _lock:
        if _session is not None:
            return _session
        try:
            import onnxruntime as ort  # imported lazily so OCR-only deployments do not need it

            opts = ort.SessionOptions()
            opts.intra_op_num_threads = int(os.environ.get("ORT_THREADS", "2"))
            opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            _session = ort.InferenceSession(str(ensure_model(download=os.environ.get("CLIP_DOWNLOAD", "1") == "1")), opts, providers=["CPUExecutionProvider"])
            _load_error = None
        except Exception as e:  # pragma: no cover - surfaced through /health
            _load_error = f"{type(e).__name__}: {e}"
            raise
    return _session


def load_error() -> str | None:
    return _load_error


def loaded() -> bool:
    return _session is not None


def embed(pixels: np.ndarray) -> tuple[list[float], int]:
    """pixels: (1,3,224,224) float32 → (unit-norm 512 floats, latency ms)."""
    t0 = time.time()
    sess = session()
    name = sess.get_inputs()[0].name
    out = sess.run(None, {name: pixels})[0][0].astype(np.float64)
    n = float(np.linalg.norm(out))
    vec = (out / n) if n > 0 else out
    return [round(float(x), 6) for x in vec], int((time.time() - t0) * 1000)
