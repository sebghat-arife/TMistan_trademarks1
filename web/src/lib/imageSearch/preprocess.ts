/**
 * Image normalisation for browser-side text recognition (Search by Image).
 *
 * Mirrors tools/image_index/preprocess.py so a stored image indexed offline
 * and a query analysed in the visitor's browser go through the same steps:
 * orientation + transparency flattening, a bounded working size, background
 * estimate, blank detection, a 99 % "ink" content box, then grayscale
 * renditions (normal + inverted, upscaled so letters are ≥ ~30 px, padded)
 * for Tesseract. Everything stays in memory; the original file is never
 * modified or uploaded.
 */
import { ImageDecodeError, decodeImageBlob } from './descriptor'

export const WORK_MAX_SIDE = 2048
export const MIN_SIDE = 16

export type Box = [x0: number, y0: number, x1: number, y1: number]

export type LoadedImage = {
  /** RGB(A) working rendition, oriented, flattened on white, ≤ WORK_MAX_SIDE. */
  canvas: HTMLCanvasElement
  data: Uint8ClampedArray
  width: number
  height: number
  /** Original dimensions before bounding. */
  originalWidth: number
  originalHeight: number
  background: [number, number, number]
  blank: boolean
  contentBox: Box
}

export type Rendition = { name: 'normal' | 'inverted'; canvas: HTMLCanvasElement; width: number; height: number }

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new ImageDecodeError('Canvas 2D is not available in this browser.')
  return { canvas, ctx }
}

/** Decode + normalise one image file. Throws ImageDecodeError for unreadable or too small images. */
export async function loadImage(blob: Blob): Promise<LoadedImage> {
  const decoded = await decodeImageBlob(blob)
  try {
    const { width: ow, height: oh } = decoded
    if (!(ow > 0 && oh > 0)) throw new ImageDecodeError()
    if (Math.min(ow, oh) < MIN_SIDE) throw new ImageDecodeError('The image is too small to analyse (minimum 16 × 16 px).')
    const scale = Math.min(1, WORK_MAX_SIDE / Math.max(ow, oh))
    const w = Math.max(1, Math.round(ow * scale))
    const h = Math.max(1, Math.round(oh * scale))
    const { canvas, ctx } = makeCanvas(w, h)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(decoded.source, 0, 0, w, h)
    const data = ctx.getImageData(0, 0, w, h).data
    const background = borderMedian(data, w, h)
    const blank = isBlank(data, w, h)
    const contentBox: Box = blank ? [0, 0, w, h] : contentBoxOf(data, w, h, background)
    return { canvas, data, width: w, height: h, originalWidth: ow, originalHeight: oh, background, blank, contentBox }
  } finally {
    decoded.close()
  }
}

function median(values: Uint8ClampedArray | number[]): number {
  const arr = Array.from(values).sort((a, b) => a - b)
  if (!arr.length) return 255
  const mid = arr.length >> 1
  return arr.length % 2 ? arr[mid] : Math.round((arr[mid - 1] + arr[mid]) / 2)
}

function borderMedian(d: Uint8ClampedArray, w: number, h: number): [number, number, number] {
  const b = Math.max(1, Math.floor(Math.min(h, w) / 40))
  const ch: [number[], number[], number[]] = [[], [], []]
  const push = (x: number, y: number) => {
    const i = (y * w + x) * 4
    ch[0].push(d[i]); ch[1].push(d[i + 1]); ch[2].push(d[i + 2])
  }
  for (let y = 0; y < h; y++) {
    const edgeRow = y < b || y >= h - b
    for (let x = 0; x < w; x++) if (edgeRow || x < b || x >= w - b) push(x, y)
  }
  return [median(ch[0]), median(ch[1]), median(ch[2])]
}

/** Standard deviation of the gray level below 4 → nothing to read. */
function isBlank(d: Uint8ClampedArray, w: number, h: number): boolean {
  const n = w * h
  let sum = 0
  let sq = 0
  for (let i = 0; i < n; i++) {
    const g = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3
    sum += g
    sq += g * g
  }
  const mean = sum / n
  return Math.sqrt(Math.max(0, sq / n - mean * mean)) < 4
}

/** Span that holds 99 % of the 'ink' (pixels differing from the background). */
function contentBoxOf(d: Uint8ClampedArray, w: number, h: number, bg: [number, number, number]): Box {
  const cols = new Float64Array(w)
  const rows = new Float64Array(h)
  let total = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const diff = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2])
      if (diff > 60) { cols[x] += 1; rows[y] += 1; total += 1 }
    }
  }
  if (total < 20) return [0, 0, w, h]
  const span = (acc: Float64Array): [number, number] => {
    let c = 0
    let lo = 0
    let hi = acc.length
    let found = false
    for (let i = 0; i < acc.length; i++) {
      c += acc[i] / total
      if (!found && c >= 0.005) { lo = i; found = true }
      if (c >= 0.995) { hi = i + 1; break }
    }
    return [lo, hi]
  }
  const [x0, x1] = span(cols)
  const [y0, y1] = span(rows)
  const padX = Math.max(2, Math.floor((x1 - x0) / 25))
  const padY = Math.max(2, Math.floor((y1 - y0) / 25))
  return [Math.max(0, x0 - padX), Math.max(0, y0 - padY), Math.min(w, x1 + padX), Math.min(h, y1 + padY)]
}

/* ----------------------------------------------------------------------------- OCR renditions */

/**
 * Grayscale renditions for Tesseract: 'normal' (dark text on light) first, then
 * the inverted rendition for light-on-dark marks. Content crop → autocontrast
 * (1 % cut-off) → upscale (height ≥ 120 px, width ≥ 400 px, ≤ 4×, longest
 * side ≤ 1600) → 24 px border in the background tone.
 */
export function ocrRenditions(img: LoadedImage): Rendition[] {
  const [bx0, by0, bx1, by1] = img.contentBox
  const useCrop = bx1 - bx0 >= 8 && by1 - by0 >= 8
  const cw = useCrop ? bx1 - bx0 : img.width
  const ch = useCrop ? by1 - by0 : img.height
  const sx = useCrop ? bx0 : 0
  const sy = useCrop ? by0 : 0
  let scale = 1
  if (ch < 120) scale = 120 / ch
  if (cw * scale < 400) scale = Math.max(scale, 400 / cw)
  scale = Math.min(scale, 4)
  if (Math.max(cw, ch) * scale > 1600) scale = 1600 / Math.max(cw, ch)
  const w = Math.max(1, Math.round(cw * scale))
  const h = Math.max(1, Math.round(ch * scale))
  const { ctx: tctx } = makeCanvas(w, h)
  tctx.imageSmoothingEnabled = true
  tctx.imageSmoothingQuality = 'high'
  tctx.drawImage(img.canvas, sx, sy, cw, ch, 0, 0, w, h)
  const src = tctx.getImageData(0, 0, w, h).data
  // grayscale (ITU-R 601 luma, like Pillow's "L") + autocontrast with 1 % cut-off
  const gray = new Uint8ClampedArray(w * h)
  const hist = new Uint32Array(256)
  for (let i = 0; i < w * h; i++) {
    const g = Math.round(src[i * 4] * 0.299 + src[i * 4 + 1] * 0.587 + src[i * 4 + 2] * 0.114)
    gray[i] = g
    hist[g] += 1
  }
  const n = w * h
  const cut = Math.floor(n * 0.01)
  let lo = 0
  let acc = 0
  for (; lo < 255; lo++) { acc += hist[lo]; if (acc > cut) break }
  let hi = 255
  acc = 0
  for (; hi > 0; hi--) { acc += hist[hi]; if (acc > cut) break }
  const range = hi > lo ? hi - lo : 1
  let sum = 0
  for (let i = 0; i < n; i++) {
    const v = Math.max(0, Math.min(255, Math.round(((gray[i] - lo) * 255) / range)))
    gray[i] = v
    sum += v
  }
  const lightBackground = sum / n > 127
  const border = 24
  const outW = w + border * 2
  const outH = h + border * 2
  const build = (invert: boolean): HTMLCanvasElement => {
    const { canvas, ctx } = makeCanvas(outW, outH)
    const out = ctx.createImageData(outW, outH)
    const od = out.data
    const borderValue = invert ? 0 : 255 // border in the normalised background tone
    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        const o = (y * outW + x) * 4
        let v = borderValue
        if (x >= border && x < outW - border && y >= border && y < outH - border) {
          v = gray[(y - border) * w + (x - border)]
          if (!lightBackground) v = 255 - v // 'normal' is always dark-on-light
          if (invert) v = 255 - v
        }
        od[o] = v; od[o + 1] = v; od[o + 2] = v; od[o + 3] = 255
      }
    }
    ctx.putImageData(out, 0, 0)
    return canvas
  }
  return [
    { name: 'normal', canvas: build(false), width: outW, height: outH },
    { name: 'inverted', canvas: build(true), width: outW, height: outH },
  ]
}

/** Encode a canvas as PNG bytes (what the OCR worker consumes). */
export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new ImageDecodeError('Could not encode the working image.'))), 'image/png')
  })
}
