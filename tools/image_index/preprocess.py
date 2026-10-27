"""Image validation and normalisation for the offline indexer (tools/image_index).

Pure Pillow/NumPy, mirroring web/src/lib/imageSearch/preprocess.ts so the
offline indexer and the visitor's browser feed Tesseract comparable renditions.
The original bytes are never written anywhere; trademark images in Storage are
never modified by this module.
"""
from __future__ import annotations

import io
from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

# Formats the web app already accepts for Search by Image (+ TIFF, common for scans).
ALLOWED_FORMATS = {"PNG", "JPEG", "WEBP", "GIF", "BMP", "TIFF", "MPO"}
MAX_PIXELS = 40_000_000          # decompression-bomb guard (Pillow raises above this)
WORK_MAX_SIDE = 2048             # longest side kept for analysis
MIN_SIDE = 16                    # anything smaller carries no usable signal

Image.MAX_IMAGE_PIXELS = MAX_PIXELS


class ImageError(ValueError):
    """Raised for invalid, corrupt, unsupported, blank or oversized images (HTTP 400)."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass
class Loaded:
    image: Image.Image          # RGB, oriented, flattened, ≤ WORK_MAX_SIDE
    width: int                  # original dimensions
    height: int
    format: str
    background: tuple[int, int, int]
    blank: bool
    content_box: tuple[int, int, int, int]


def load_image(data: bytes, max_bytes: int) -> Loaded:
    if not data:
        raise ImageError("empty", "The uploaded file is empty.")
    if len(data) > max_bytes:
        raise ImageError("too_large", f"The image is larger than {max_bytes // (1024 * 1024)} MB.")
    try:
        im = Image.open(io.BytesIO(data))
        fmt = (im.format or "").upper()
        if fmt not in ALLOWED_FORMATS:
            raise ImageError("unsupported", f"Unsupported image format: {fmt or 'unknown'}.")
        im.load()
    except ImageError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as e:
        raise ImageError("corrupt", "The file could not be decoded as an image.") from e

    width, height = im.size
    if min(width, height) < MIN_SIDE:
        raise ImageError("too_small", "The image is too small to analyse (minimum 16 × 16 px).")

    # 1. orientation from EXIF, 2. animated → first frame, 3. transparency → flattened on white
    im = ImageOps.exif_transpose(im)
    if getattr(im, "n_frames", 1) > 1:
        im.seek(0)
    if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
        rgba = im.convert("RGBA")
        flat = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        flat.alpha_composite(rgba)
        im = flat.convert("RGB")
    else:
        im = im.convert("RGB")

    # 4. bound the working size (keeps memory predictable on small instances)
    if max(im.size) > WORK_MAX_SIDE:
        im.thumbnail((WORK_MAX_SIDE, WORK_MAX_SIDE), Image.Resampling.LANCZOS)

    arr = np.asarray(im, dtype=np.uint8)
    background = _border_median(arr)
    blank = _is_blank(arr)
    box = _content_box(arr, background) if not blank else (0, 0, im.width, im.height)
    return Loaded(im, width, height, fmt, background, blank, box)


def _border_median(arr: np.ndarray) -> tuple[int, int, int]:
    h, w = arr.shape[:2]
    b = max(1, min(h, w) // 40)
    edge = np.concatenate([arr[:b].reshape(-1, 3), arr[-b:].reshape(-1, 3), arr[:, :b].reshape(-1, 3), arr[:, -b:].reshape(-1, 3)])
    med = np.median(edge, axis=0)
    return tuple(int(x) for x in med)


def _is_blank(arr: np.ndarray) -> bool:
    gray = arr.mean(axis=2)
    return float(gray.std()) < 4.0


def _content_box(arr: np.ndarray, bg: tuple[int, int, int]) -> tuple[int, int, int, int]:
    """Span that holds 99 % of the 'ink' (pixels differing from the background)."""
    diff = np.abs(arr.astype(np.int16) - np.array(bg, dtype=np.int16)).sum(axis=2)
    ink = (diff > 60).astype(np.float32)
    total = ink.sum()
    h, w = ink.shape
    if total < 20:
        return (0, 0, w, h)
    cols = ink.sum(axis=0).cumsum() / total
    rows = ink.sum(axis=1).cumsum() / total
    x0 = int(np.searchsorted(cols, 0.005)); x1 = int(np.searchsorted(cols, 0.995)) + 1
    y0 = int(np.searchsorted(rows, 0.005)); y1 = int(np.searchsorted(rows, 0.995)) + 1
    pad_x = max(2, (x1 - x0) // 25); pad_y = max(2, (y1 - y0) // 25)
    return (max(0, x0 - pad_x), max(0, y0 - pad_y), min(w, x1 + pad_x), min(h, y1 + pad_y))


def crop_content(loaded: Loaded) -> Image.Image:
    x0, y0, x1, y1 = loaded.content_box
    if x1 - x0 < 8 or y1 - y0 < 8:
        return loaded.image
    return loaded.image.crop((x0, y0, x1, y1))


# ----------------------------------------------------------------------------- OCR renditions

def ocr_variants(loaded: Loaded) -> list[tuple[str, Image.Image]]:
    """Grayscale renditions for Tesseract: (name, image). 'normal' first, then the
    inverted rendition for light-on-dark marks. Upscaled so letters are ≥ ~30 px."""
    im = crop_content(loaded).convert("L")
    im = ImageOps.autocontrast(im, cutoff=1)
    w, h = im.size
    scale = 1.0
    if h < 120:
        scale = 120 / h
    if w * scale < 400:
        scale = max(scale, 400 / w)
    scale = min(scale, 4.0)
    if max(w, h) * scale > 1600:
        scale = 1600 / max(w, h)
    if abs(scale - 1.0) > 0.01:
        im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.LANCZOS)
    im = ImageOps.expand(im, border=24, fill=255 if _mean(im) > 127 else 0)
    normal = im if _mean(im) > 127 else ImageOps.invert(im)
    inverted = ImageOps.invert(normal)
    return [("normal", normal), ("inverted", inverted)]


def _mean(im: Image.Image) -> float:
    return float(np.asarray(im, dtype=np.uint8).mean())
