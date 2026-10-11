/**
 * Visual descriptor for "Search by Image".
 *
 * A compact, deterministic signature of a trademark image computed entirely in
 * the browser (Canvas 2D, no network, no ML model download). The same function
 * runs when an administrator indexes the published images and when a visitor
 * uploads a query image, so both sides produce comparable vectors; similarity
 * is the cosine similarity of the two L2-normalised vectors (pgvector `<=>`).
 *
 * Pipeline (version 1, 369 dimensions):
 *   1. render on the estimated background colour (border median) and find the
 *      robust content box (the span holding 99% of the "ink"), so uneven
 *      gazette margins, specks and grey scans do not move the crop;
 *   2. contrast-normalise and resample the content box to 64×64 (pure JS,
 *      independent of the browser's canvas filter);
 *   3. features
 *      A  perceptual hash  — signs of 99 low-frequency DCT coefficients (±1),
 *                            the classic pHash: unrelated images score ≈ 0;
 *      B  DCT magnitudes   — the same coefficients, radially weighted, for
 *                            graded (not just binary) shape similarity;
 *      C  stroke structure — gradient-orientation histogram, 4×4 cells × 8 bins,
 *                            each cell normalised (HOG-like);
 *      D  colour           — HSV histogram of the non-background pixels (33 bins);
 *      E  geometry         — soft-binned aspect ratio and ink density (10 values).
 *   Blocks are L2-normalised, weighted and concatenated; the whole vector is
 *   L2-normalised again so the dot product is the cosine similarity.
 *
 * Limitations (by design — this is perceptual/structural similarity, not a
 * neural embedding): it is not rotation-invariant, it compares the whole image
 * (a logo embedded in a photo will not match), and two unrelated word marks set
 * in similar type can still score moderately. Results are therefore presented
 * as a computational indicator, never as a legal determination.
 *
 * Bump DESCRIPTOR_VERSION whenever the computation changes; the database keeps
 * the version next to every stored vector and the search only compares equals.
 */

export const DESCRIPTOR_VERSION = 1
export const DCT_SIDE = 10 // 10×10 low-frequency block → 99 coefficients (DC excluded)
export const EDGE_CELLS = 4 // 4×4 spatial grid
export const EDGE_BINS = 8 // unsigned orientation bins
export const COLOR_BINS = 33 // 8 hue × 2 saturation × 2 value + achromatic
export const GEOMETRY_BINS = 10 // 5 aspect-ratio + 5 ink-density soft bins
const DCT_COEFFS = DCT_SIDE * DCT_SIDE - 1
export const DESCRIPTOR_DIMS = DCT_COEFFS * 2 + EDGE_CELLS * EDGE_CELLS * EDGE_BINS + COLOR_BINS + GEOMETRY_BINS // 369

const SIZE = 64 // analysis resolution
const WORK_MAX = 512 // longest side of the intermediate rendition
const W_HASH = 1.0
const W_DCT = 0.5
const W_EDGE = 0.6
const W_COLOR = 0.4
const W_GEOM = 0.5

export type Descriptor = Float32Array

/** Accepted query/index image types (what browsers decode reliably). */
export const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'] as const
export const MAX_QUERY_IMAGE_BYTES = 8 * 1024 * 1024

export class ImageDecodeError extends Error {
  constructor(message = 'The image could not be decoded.') {
    super(message)
    this.name = 'ImageDecodeError'
  }
}

/* ── Decoding ──────────────────────────────────────────────────────────── */

async function decodeBlob(blob: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(blob)
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() }
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new ImageDecodeError())
      el.src = url
    })
    if (!img.naturalWidth || !img.naturalHeight) throw new ImageDecodeError()
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) }
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e instanceof ImageDecodeError ? e : new ImageDecodeError()
  }
}

/** Compute the descriptor of an image file/blob. Throws ImageDecodeError when the image cannot be read. */
export async function describeImage(blob: Blob): Promise<Descriptor> {
  const decoded = await decodeBlob(blob)
  try {
    return describeSource(decoded.source, decoded.width, decoded.height)
  } finally {
    decoded.close()
  }
}

/* ── Pixel pipeline ────────────────────────────────────────────────────── */

export function describeSource(source: CanvasImageSource, srcWidth: number, srcHeight: number): Descriptor {
  if (!(srcWidth > 0 && srcHeight > 0)) throw new ImageDecodeError()
  const scale = Math.min(1, WORK_MAX / Math.max(srcWidth, srcHeight))
  const w = Math.max(1, Math.round(srcWidth * scale))
  const h = Math.max(1, Math.round(srcHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new ImageDecodeError('Canvas 2D is not available in this browser.')
  ctx.fillStyle = '#ffffff' // flatten transparency on white (gazette crops are printed on white)
  ctx.fillRect(0, 0, w, h)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h)
  return describePixels(data, w, h)
}

/** Pure function over RGBA pixels (exported for tests). */
export function describePixels(rgba: Uint8ClampedArray, w: number, h: number): Descriptor {
  const bg = backgroundColor(rgba, w, h)
  const ink = inkMask(rgba, w, h, bg)
  const box = contentBox(ink, w, h, bg)
  const { gray, rgb, inkDensity } = resampleBox(rgba, ink, w, box)
  const dct = dctCoefficients(gray)
  const hash = hashFeatures(dct)
  const mags = magnitudeFeatures(dct)
  const edges = edgeFeatures(gray)
  const color = colorFeatures(rgb, bg)
  const geom = geometryFeatures((box.x1 - box.x0 + 1) / (box.y1 - box.y0 + 1), inkDensity)

  const out = new Float32Array(DESCRIPTOR_DIMS)
  let o = 0
  for (let i = 0; i < hash.length; i++) out[o++] = hash[i] * W_HASH
  for (let i = 0; i < mags.length; i++) out[o++] = mags[i] * W_DCT
  for (let i = 0; i < edges.length; i++) out[o++] = edges[i] * W_EDGE
  for (let i = 0; i < color.length; i++) out[o++] = color[i] * W_COLOR
  for (let i = 0; i < geom.length; i++) out[o++] = geom[i] * W_GEOM
  l2normalize(out)
  return out
}

type Box = { x0: number; y0: number; x1: number; y1: number }
type RGB = [number, number, number]

/** Diagnostics for tests/tools: background estimate, content box and ink density. */
export function inspectPixels(rgba: Uint8ClampedArray, w: number, h: number): { background: RGB; box: Box; inkDensity: number; inkFraction: number } {
  const bg = backgroundColor(rgba, w, h)
  const ink = inkMask(rgba, w, h, bg)
  const box = contentBox(ink, w, h, bg)
  const { inkDensity } = resampleBox(rgba, ink, w, box)
  let n = 0
  for (let i = 0; i < ink.length; i++) n += ink[i]
  return { background: bg, box, inkDensity, inkFraction: n / (w * h) }
}

/** Background colour = per-channel median of the outer border pixels. */
function backgroundColor(d: Uint8ClampedArray, w: number, h: number): RGB {
  const rs: number[] = [], gs: number[] = [], bs: number[] = []
  const push = (x: number, y: number) => {
    const i = (y * w + x) * 4
    rs.push(d[i]); gs.push(d[i + 1]); bs.push(d[i + 2])
  }
  const t = Math.max(1, Math.round(Math.min(w, h) * 0.02))
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < t || y < t || x >= w - t || y >= h - t) push(x, y)
  const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1] ?? 255
  return [med(rs), med(gs), med(bs)]
}

/** 1 = ink (differs clearly from the background colour), 0 = background. */
function inkMask(d: Uint8ClampedArray, w: number, h: number, bg: RGB): Uint8Array {
  const m = new Uint8Array(w * h)
  for (let k = 0; k < w * h; k++) {
    const i = k * 4
    const dist = Math.max(Math.abs(d[i] - bg[0]), Math.abs(d[i + 1] - bg[1]), Math.abs(d[i + 2] - bg[2]))
    if (dist > 40) m[k] = 1
  }
  return m
}

/**
 * Content box of the ink after removing specks (plus 3% padding).
 *
 * Specks = 4-connected components smaller than 2% of the total ink. They are
 * dropped from the mask (in place) only when they amount to less than 10% of the
 * ink altogether, so dotted/halftone artwork is left intact. Removing specks by
 * component size is far more stable than trimming by ink profile: a scanner
 * fleck near a corner would otherwise flip the crop depending on compression.
 * Dark images (dark border colour) are treated as a mark on its own panel: the
 * whole image is the content, which keeps a dark logo consistent whether or
 * not the query carries a white margin around it.
 */
function contentBox(ink: Uint8Array, w: number, h: number, bg: RGB): Box {
  const full = { x0: 0, y0: 0, x1: w - 1, y1: h - 1 }
  if (0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2] < 128) return full
  let total = 0
  for (let i = 0; i < ink.length; i++) total += ink[i]
  if (total < 0.002 * w * h) return full // blank / uniform image

  // connected components (4-connectivity), iterative flood fill
  const label = new Int32Array(w * h) // 0 = unlabelled
  const areas: number[] = [0]
  const stack: number[] = []
  for (let seed = 0; seed < w * h; seed++) {
    if (!ink[seed] || label[seed]) continue
    const id = areas.length
    let area = 0
    label[seed] = id
    stack.push(seed)
    while (stack.length) {
      const k = stack.pop() as number
      area++
      const x = k % w, y = (k - x) / w
      if (x > 0 && ink[k - 1] && !label[k - 1]) { label[k - 1] = id; stack.push(k - 1) }
      if (x < w - 1 && ink[k + 1] && !label[k + 1]) { label[k + 1] = id; stack.push(k + 1) }
      if (y > 0 && ink[k - w] && !label[k - w]) { label[k - w] = id; stack.push(k - w) }
      if (y < h - 1 && ink[k + w] && !label[k + w]) { label[k + w] = id; stack.push(k + w) }
    }
    areas.push(area)
  }
  const speckMax = Math.max(4, total * 0.02)
  let speckTotal = 0
  for (let id = 1; id < areas.length; id++) if (areas[id] < speckMax) speckTotal += areas[id]
  const dropSpecks = speckTotal > 0 && speckTotal < total * 0.1

  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let k = 0; k < w * h; k++) {
    if (!ink[k]) continue
    if (dropSpecks && areas[label[k]] < speckMax) { ink[k] = 0; continue }
    const x = k % w, y = (k - x) / w
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  if (x1 < 0) return full
  const padX = Math.round((x1 - x0 + 1) * 0.03), padY = Math.round((y1 - y0 + 1) * 0.03)
  return { x0: Math.max(0, x0 - padX), y0: Math.max(0, y0 - padY), x1: Math.min(w - 1, x1 + padX), y1: Math.min(h - 1, y1 + padY) }
}

/**
 * Area-average the content box into SIZE×SIZE (anisotropic — the aspect ratio
 * is kept separately in the geometry block, and stretching gives wide word
 * marks their full resolution). Grey values are contrast-normalised so that the
 * background maps to 1 and the darkest ink to 0. Pure JS so the result does not
 * depend on the browser's canvas resampling filter.
 */
function resampleBox(d: Uint8ClampedArray, ink: Uint8Array, w: number, box: Box) {
  const cw = box.x1 - box.x0 + 1, ch = box.y1 - box.y0 + 1
  const gray = new Float32Array(SIZE * SIZE)
  const rgb = new Float32Array(SIZE * SIZE * 3)
  let inkCount = 0
  for (let ty = 0; ty < SIZE; ty++) {
    const sy0 = box.y0 + Math.floor((ty * ch) / SIZE)
    const sy1 = Math.max(sy0 + 1, box.y0 + Math.floor(((ty + 1) * ch) / SIZE))
    for (let tx = 0; tx < SIZE; tx++) {
      const sx0 = box.x0 + Math.floor((tx * cw) / SIZE)
      const sx1 = Math.max(sx0 + 1, box.x0 + Math.floor(((tx + 1) * cw) / SIZE))
      let r = 0, g = 0, b = 0, n = 0, inkN = 0
      for (let y = sy0; y < sy1; y++) {
        for (let x = sx0; x < sx1; x++) {
          const k = y * w + x
          r += d[k * 4]; g += d[k * 4 + 1]; b += d[k * 4 + 2]
          inkN += ink[k]
          n++
        }
      }
      const q = ty * SIZE + tx
      rgb[q * 3] = r / n
      rgb[q * 3 + 1] = g / n
      rgb[q * 3 + 2] = b / n
      gray[q] = (0.299 * r + 0.587 * g + 0.114 * b) / n / 255
      if (inkN * 2 >= n) inkCount++
    }
  }
  // contrast normalisation: background → 1, darkest 2% of cells → 0
  const sorted = Array.from(gray).sort((a, b) => a - b)
  const lo = sorted[Math.floor(sorted.length * 0.02)]
  const hi = sorted[Math.floor(sorted.length * 0.98)]
  if (hi - lo > 0.05) for (let i = 0; i < gray.length; i++) gray[i] = Math.min(1, Math.max(0, (gray[i] - lo) / (hi - lo)))
  return { gray, rgb, inkDensity: inkCount / (SIZE * SIZE) }
}

/* ── Features ──────────────────────────────────────────────────────────── */

let cosTable: Float32Array | null = null
function cosines(): Float32Array {
  if (cosTable) return cosTable
  const t = new Float32Array(DCT_SIDE * SIZE)
  for (let u = 0; u < DCT_SIDE; u++) for (let x = 0; x < SIZE; x++) t[u * SIZE + x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * SIZE))
  cosTable = t
  return t
}

/** Low-frequency 2-D DCT-II coefficients of the mean-removed grey image (99 values, DC excluded, row-major (v,u)). */
function dctCoefficients(gray: Float32Array): Float32Array {
  const c = cosines()
  let mean = 0
  for (let i = 0; i < gray.length; i++) mean += gray[i]
  mean /= gray.length
  const rows = new Float32Array(SIZE * DCT_SIDE)
  for (let y = 0; y < SIZE; y++) {
    for (let u = 0; u < DCT_SIDE; u++) {
      let acc = 0
      for (let x = 0; x < SIZE; x++) acc += (gray[y * SIZE + x] - mean) * c[u * SIZE + x]
      rows[y * DCT_SIDE + u] = acc
    }
  }
  const out = new Float32Array(DCT_COEFFS)
  let o = 0
  for (let v = 0; v < DCT_SIDE; v++) {
    for (let u = 0; u < DCT_SIDE; u++) {
      if (u === 0 && v === 0) continue
      let acc = 0
      for (let y = 0; y < SIZE; y++) acc += rows[y * DCT_SIDE + u] * c[v * SIZE + y]
      out[o++] = acc
    }
  }
  return out
}

/** Block A — pHash: sign of each coefficient relative to the median, ±1/√n. */
function hashFeatures(dct: Float32Array): Float32Array {
  const sorted = Array.from(dct).sort((a, b) => a - b)
  const median = sorted[sorted.length >> 1]
  const out = new Float32Array(dct.length)
  const unit = 1 / Math.sqrt(dct.length)
  for (let i = 0; i < dct.length; i++) out[i] = dct[i] > median ? unit : -unit
  return out
}

/** Block B — radially weighted coefficient magnitudes (so mid frequencies count), L2-normalised. */
function magnitudeFeatures(dct: Float32Array): Float32Array {
  const out = new Float32Array(dct.length)
  let o = 0
  for (let v = 0; v < DCT_SIDE; v++) {
    for (let u = 0; u < DCT_SIDE; u++) {
      if (u === 0 && v === 0) continue
      out[o] = dct[o] * Math.sqrt(u * u + v * v)
      o++
    }
  }
  l2normalize(out)
  return out
}

/** Block C — gradient-orientation histogram (Sobel, unsigned, 8 bins) per 4×4 cell, cell-normalised then L2-normalised. */
function edgeFeatures(gray: Float32Array): Float32Array {
  const out = new Float32Array(EDGE_CELLS * EDGE_CELLS * EDGE_BINS)
  const at = (x: number, y: number) => gray[Math.min(SIZE - 1, Math.max(0, y)) * SIZE + Math.min(SIZE - 1, Math.max(0, x))]
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const gx = -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1) + at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)
      const gy = -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)
      const mag = Math.hypot(gx, gy)
      if (mag < 0.05) continue
      let theta = Math.atan2(gy, gx)
      if (theta < 0) theta += Math.PI
      const bin = Math.min(EDGE_BINS - 1, Math.floor((theta / Math.PI) * EDGE_BINS))
      const cx = Math.floor((x * EDGE_CELLS) / SIZE), cy = Math.floor((y * EDGE_CELLS) / SIZE)
      out[(cy * EDGE_CELLS + cx) * EDGE_BINS + bin] += mag
    }
  }
  for (let cell = 0; cell < EDGE_CELLS * EDGE_CELLS; cell++) {
    const seg = out.subarray(cell * EDGE_BINS, (cell + 1) * EDGE_BINS)
    l2normalize(seg)
  }
  l2normalize(out)
  return out
}

/** Block D — HSV histogram of non-background pixels (Hellinger-scaled, L2-normalised, 33 values). */
function colorFeatures(rgb: Float32Array, bg: RGB): Float32Array {
  const out = new Float32Array(COLOR_BINS)
  let total = 0
  for (let k = 0; k < SIZE * SIZE; k++) {
    const R = rgb[k * 3], G = rgb[k * 3 + 1], B = rgb[k * 3 + 2]
    if (Math.max(Math.abs(R - bg[0]), Math.abs(G - bg[1]), Math.abs(B - bg[2])) <= 40) continue // background
    const r = R / 255, g = G / 255, b = B / 255
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    const v = max, s = max === 0 ? 0 : (max - min) / max
    let idx: number
    if (s < 0.15) idx = COLOR_BINS - 1 // black / grey / white ink
    else {
      const delta = max - min
      let hh: number
      if (max === r) hh = ((g - b) / delta) % 6
      else if (max === g) hh = (b - r) / delta + 2
      else hh = (r - g) / delta + 4
      if (hh < 0) hh += 6
      const hueBin = Math.min(7, Math.floor((hh / 6) * 8))
      idx = hueBin * 4 + (s < 0.5 ? 0 : 2) + (v < 0.5 ? 0 : 1)
    }
    out[idx] += 1
    total++
  }
  if (total === 0) return out
  for (let i = 0; i < out.length; i++) out[i] = Math.sqrt(out[i] / total)
  l2normalize(out)
  return out
}

/** Block E — soft-binned log2 aspect ratio (centres −2…2) and ink density (centres 0.1…0.75), L2-normalised. */
function geometryFeatures(aspect: number, inkDensity: number): Float32Array {
  const out = new Float32Array(GEOMETRY_BINS)
  const la = Math.max(-3, Math.min(3, Math.log2(aspect || 1)))
  const aCentres = [-2, -1, 0, 1, 2], dCentres = [0.1, 0.25, 0.4, 0.55, 0.75]
  for (let i = 0; i < 5; i++) out[i] = Math.exp(-((la - aCentres[i]) ** 2) / (2 * 0.6 * 0.6))
  for (let i = 0; i < 5; i++) out[5 + i] = Math.exp(-((inkDensity - dCentres[i]) ** 2) / (2 * 0.1 * 0.1))
  l2normalize(out)
  return out
}

function l2normalize(v: Float32Array) {
  let n = 0
  for (let i = 0; i < v.length; i++) n += v[i] * v[i]
  n = Math.sqrt(n)
  if (n > 0) for (let i = 0; i < v.length; i++) v[i] /= n
}

/** Cosine similarity of two normalised descriptors (used for client-side sanity checks/tests). */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

/** Plain number array with limited precision — what we send to the database. */
export function toVector(d: Descriptor): number[] {
  return Array.from(d, (x) => Math.round(x * 1e6) / 1e6)
}

/** Basic client-side validation of a query file before decoding. */
export function validateQueryFile(file: File): 'ok' | 'type' | 'size' {
  if (file.size > MAX_QUERY_IMAGE_BYTES) return 'size'
  if (file.type && !(SUPPORTED_IMAGE_TYPES as readonly string[]).includes(file.type)) return 'type'
  if (!file.type && !/\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)) return 'type'
  return 'ok'
}
