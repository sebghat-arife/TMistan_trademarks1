/**
 * Browser text recognition for Search by Image — Tesseract.js (WebAssembly)
 * running in Web Workers, self-hosted (no CDN), lazy-loaded on first use and
 * cached by the browser afterwards.
 *
 *   • Latin (eng) and Arabic-script (fas + pus) passes on a normalised
 *     rendition; the inverted rendition and sparse mode only when nothing
 *     confident was found (same policy as tools/image_index/ocr.py).
 *   • Words are returned with per-word confidence and script; low-confidence
 *     readings are flagged `uncertain` so the UI asks the visitor to confirm.
 *   • Nothing leaves the device: the image bytes stay in memory.
 *
 * Costs the visitor pays once per device (then cached): the Tesseract core
 * (~3.9 MB JS+wasm, SIMD build) and the language models (eng 2.0 MB, fas 0.3 MB,
 * pus 1.4 MB, gzip). Both are served from this static site.
 */
import { createWorker, OEM, PSM, type Block, type Worker } from 'tesseract.js'
import { simd } from 'wasm-feature-detect'
import workerUrl from 'tesseract.js/dist/worker.min.js?url'
import coreSimdUrl from 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url'
import coreUrl from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url'
import { normalizeText, plausibleToken, scriptOf, type Script } from './textnorm'
import { canvasToBlob, ocrRenditions, type LoadedImage } from './preprocess'

/** Identifies the OCR models used for stored rows (shared with tools/image_index/version.py). */
export const OCR_MODEL_VERSION = 'tesseract-fast-eng-fas-pus-v1'
export const OCR_ENGINE = 'tesseract.js@7.0.0'
export const OCR_LANGS = ['eng', 'fas', 'pus'] as const
const LATIN = 'eng'
const ARABIC = 'fas+pus'
/** Approximate one-time download, used in the UI notice (core + 3 language models, compressed). */
export const OCR_DOWNLOAD_MB = 8

export const MIN_WORD_CONF = 55
export const CONFIDENT = 75
const PASS_TIMEOUT_MS = 25_000
const DEFAULT_BUDGET_MS = 15_000
const CACHE_PATH = 'tmistan-ocr-fast-v1' // IndexedDB key prefix for cached traineddata

export type OcrWord = { text: string; normalized: string; confidence: number; script: Script; lang: string }
export type OcrOutcome = {
  text: string
  confidence: number
  scripts: Script[]
  uncertain: boolean
  words: OcrWord[]
  passes: number
  duration_ms: number
  engine: string
  error: string | null
}

export type OcrEngineState =
  | { status: 'idle' }
  | { status: 'loading'; progress: number; step: 'core' | 'language' | 'init' }
  | { status: 'ready' }
  | { status: 'failed'; message: string }

/* ----------------------------------------------------------------------------- capability */

export type OcrSupport = 'ok' | 'unsupported' | 'save_data'

/** Can this browser run the recogniser at all, and should it do so automatically? */
export function ocrSupport(): OcrSupport {
  if (typeof window === 'undefined') return 'unsupported'
  if (typeof WebAssembly !== 'object' || typeof Worker !== 'function' || typeof indexedDB === 'undefined') return 'unsupported'
  if (typeof document === 'undefined' || typeof document.createElement('canvas').getContext !== 'function') return 'unsupported'
  const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number }
  if (nav.connection?.saveData) return 'save_data'
  return 'ok'
}

/** Workers to run in parallel: two on a desktop-class device, one otherwise. */
export function defaultConcurrency(): number {
  const nav = navigator as Navigator & { deviceMemory?: number }
  const cores = navigator.hardwareConcurrency ?? 2
  const mem = nav.deviceMemory ?? 4
  return cores >= 4 && mem >= 4 ? 2 : 1
}

/* ----------------------------------------------------------------------------- worker pool */

type Slot = { worker: Worker; langs: string; busy: boolean }

const listeners = new Set<(s: OcrEngineState) => void>()
let state: OcrEngineState = { status: 'idle' }
let slots: Slot[] = []
let warming: Promise<void> | null = null
let waiters: Array<(s: Slot) => void> = []

function setState(s: OcrEngineState) {
  state = s
  for (const l of listeners) l(s)
}
export function getOcrEngineState(): OcrEngineState { return state }
export function subscribeOcrEngine(fn: (s: OcrEngineState) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

function absolute(url: string): string {
  return new URL(url, window.location.href).href
}

/** No download/initialisation progress for this long → give up (slow links still get ~1 KB/s headroom on 8 MB). */
const STALL_MS = 90_000

function friendlyStartupError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  if (/network error|failed to fetch|response code|load failed|404|403/i.test(raw)) {
    return new Error('The text-recognition files could not be downloaded.')
  }
  if (/memory|allocation|out of memory|RangeError/i.test(raw)) {
    return new Error('Not enough memory to start text recognition on this device.')
  }
  return new Error(raw || 'Text recognition could not be started.')
}

async function spawn(onProgress?: (p: number, step: 'core' | 'language' | 'init') => void): Promise<Slot> {
  const corePath = (await simd()) ? coreSimdUrl : coreUrl
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  // Tesseract.js reports download/initialisation failures through `errorHandler` and never
  // settles the createWorker promise, so race it against an explicit failure + a stall watchdog.
  let fail!: (e: Error) => void
  const failure = new Promise<never>((_, reject) => { fail = reject })
  let lastActivity = performance.now()
  const watchdog = setInterval(() => {
    if (performance.now() - lastActivity > STALL_MS) fail(new Error('The text-recognition files could not be downloaded (timed out).'))
  }, 5_000)
  try {
    const worker = await Promise.race([
      createWorker([...OCR_LANGS], OEM.LSTM_ONLY, {
        workerPath: absolute(workerUrl),
        corePath: absolute(corePath),
        langPath: absolute(`${base}/ocr/tessdata`),
        cachePath: CACHE_PATH,
        workerBlobURL: false,
        gzip: true,
        logger: (m) => {
          lastActivity = performance.now()
          if (!onProgress) return
          if (m.status === 'loading tesseract core') onProgress(m.progress * 0.5, 'core')
          else if (m.status === 'loading language traineddata') onProgress(0.5 + m.progress * 0.4, 'language')
          else if (m.status === 'initializing api' || m.status === 'initializing tesseract') onProgress(0.9 + m.progress * 0.1, 'init')
        },
        errorHandler: (err: unknown) => fail(friendlyStartupError(err)),
      }),
      failure,
    ])
    return { worker, langs: OCR_LANGS.join('+'), busy: false }
  } finally {
    clearInterval(watchdog)
  }
}

/**
 * Download + initialise the recogniser (idempotent; concurrent callers share the
 * same promise). Resolves when at least one worker is ready; extra workers are
 * added lazily by `acquire`.
 */
export function warmUpOcr(): Promise<void> {
  if (slots.length) return Promise.resolve()
  if (warming) return warming
  setState({ status: 'loading', progress: 0, step: 'core' })
  warming = spawn((progress, step) => setState({ status: 'loading', progress, step }))
    .then((slot) => {
      slots.push(slot)
      setState({ status: 'ready' })
    })
    .catch((e: unknown) => {
      const message = e instanceof Error ? e.message : typeof e === 'string' ? e : 'Text recognition could not be started.'
      setState({ status: 'failed', message })
      throw new OcrUnavailableError(message)
    })
    .finally(() => { warming = null })
  return warming
}

export class OcrUnavailableError extends Error {
  constructor(message = 'Text recognition is not available in this browser.') {
    super(message)
    this.name = 'OcrUnavailableError'
  }
}

async function acquire(langs: string, maxWorkers: number): Promise<Slot> {
  await warmUpOcr()
  const free = slots.filter((s) => !s.busy)
  const pick = free.find((s) => s.langs === langs) ?? free[0]
  if (pick) { pick.busy = true; return pick }
  if (slots.length < maxWorkers) {
    const slot = await spawn()
    slots.push(slot)
    slot.busy = true
    return slot
  }
  return new Promise<Slot>((resolve) => { waiters.push((s) => { s.busy = true; resolve(s) }) })
}

function release(slot: Slot) {
  slot.busy = false
  const next = waiters.shift()
  if (next) next(slot)
}

async function discard(slot: Slot) {
  slots = slots.filter((s) => s !== slot)
  try { await slot.worker.terminate() } catch { /* already gone */ }
  if (!slots.length && !warming) setState({ status: 'idle' })
}

/** Free every worker (e.g. when the admin indexer finishes). */
export async function shutdownOcr(): Promise<void> {
  const all = slots
  slots = []
  waiters = []
  await Promise.all(all.map((s) => s.worker.terminate().catch(() => undefined)))
  setState({ status: 'idle' })
}

/* ----------------------------------------------------------------------------- recognition */

const GLUE = /[\s\-_/|\\.,;:!?()[\]{}"'`«»]+/

function harvest(blocks: Block[] | null | undefined, lang: string): OcrWord[] {
  const wanted: Script = lang === LATIN ? 'latin' : 'arabic'
  const out: OcrWord[] = []
  for (const b of blocks ?? []) {
    for (const p of b.paragraphs ?? []) {
      for (const l of p.lines ?? []) {
        for (const w of l.words ?? []) {
          const raw = (w.text ?? '').trim()
          const c = Number(w.confidence)
          if (!raw || !Number.isFinite(c) || c < MIN_WORD_CONF) continue
          for (const piece of raw.split(GLUE)) {
            if (!piece) continue
            const norm = normalizeText(piece)
            if (!norm) continue
            const s = scriptOf(norm)
            if (s === 'digit') {
              if (plausibleToken(norm, s)) out.push({ text: piece, normalized: norm, confidence: c, script: s, lang })
              continue
            }
            if (s !== wanted || !plausibleToken(norm, s)) continue
            out.push({ text: piece, normalized: norm, confidence: c, script: s, lang })
          }
        }
      }
    }
  }
  return out
}

type Pass = { blob: Blob; lang: string; psm: PSM; rendition: string }

async function runPass(pass: Pass, maxWorkers: number, signal?: AbortSignal): Promise<OcrWord[]> {
  const slot = await acquire(pass.lang, maxWorkers)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    if (signal?.aborted) return []
    if (slot.langs !== pass.lang) {
      await slot.worker.reinitialize(pass.lang, OEM.LSTM_ONLY)
      slot.langs = pass.lang
    }
    await slot.worker.setParameters({ tessedit_pageseg_mode: pass.psm })
    const job = slot.worker.recognize(pass.blob, {}, { text: false, blocks: true })
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), PASS_TIMEOUT_MS) })
    const res = await Promise.race([job, timeout])
    return harvest(res.data.blocks, pass.lang)
  } catch (e) {
    // A hung or crashed worker is thrown away; the next pass gets a fresh one.
    await discard(slot)
    if (e instanceof Error && e.message === 'timeout') return []
    throw e
  } finally {
    if (timer) clearTimeout(timer)
    if (slots.includes(slot)) release(slot)
  }
}

export type RecogniseOptions = { signal?: AbortSignal; budgetMs?: number; concurrency?: number }

/**
 * Adaptive multi-pass OCR of a pre-processed image. Never throws for "no text":
 * an empty word list with `error: null` means nothing plausible was read.
 * Throws OcrUnavailableError when the engine cannot be started.
 */
export async function recogniseImage(img: LoadedImage, opts: RecogniseOptions = {}): Promise<OcrOutcome> {
  const t0 = performance.now()
  const budget = opts.budgetMs ?? DEFAULT_BUDGET_MS
  const maxWorkers = Math.max(1, opts.concurrency ?? defaultConcurrency())
  const done = (words: OcrWord[], passes: number, error: string | null): OcrOutcome => {
    const lettered = words.filter((w) => w.script !== 'digit')
    const kept = (lettered.length ? lettered : words).slice(0, 12)
    const confidence = kept.length ? kept.reduce((a, w) => a + w.confidence, 0) / kept.length : 0
    const scripts = Array.from(new Set(kept.map((w) => w.script).filter((s): s is Script => s === 'latin' || s === 'arabic'))).sort()
    return {
      text: kept.map((w) => w.text).join(' '),
      confidence: Math.round(confidence * 10) / 10,
      scripts,
      uncertain: !kept.length || confidence < CONFIDENT,
      words: kept,
      passes,
      duration_ms: Math.round(performance.now() - t0),
      engine: OCR_ENGINE,
      error,
    }
  }
  if (img.blank) return done([], 0, 'blank')
  await warmUpOcr()
  const renditions = ocrRenditions(img)
  const blobs = await Promise.all(renditions.map((r) => canvasToBlob(r.canvas)))
  const normal = { blob: blobs[0], name: renditions[0].name }
  const inverted = { blob: blobs[1], name: renditions[1].name }
  let found: OcrWord[] = []
  let passes = 0
  const good = (ws: OcrWord[]) => ws.some((w) => w.confidence >= CONFIDENT && w.normalized.length >= 3)
  const budgetLeft = () => performance.now() - t0 < budget && !opts.signal?.aborted
  const both = async (r: { blob: Blob; name: string }, psm: PSM) => {
    const passesToRun: Pass[] = [LATIN, ARABIC].map((lang) => ({ blob: r.blob, lang, psm, rendition: r.name }))
    if (maxWorkers > 1) {
      const results = await Promise.all(passesToRun.map((p) => runPass(p, maxWorkers, opts.signal)))
      passes += results.length
      for (const r of results) found = found.concat(r)
      return
    }
    for (const p of passesToRun) {
      if (passes > 0 && !budgetLeft()) return
      found = found.concat(await runPass(p, maxWorkers, opts.signal))
      passes += 1
    }
  }
  await both(normal, PSM.SINGLE_BLOCK)
  if (!good(found) && budgetLeft()) await both(inverted, PSM.SINGLE_BLOCK)
  if (!found.length && budgetLeft()) await both(normal, PSM.SPARSE_TEXT) // sparse mode only when nothing plausible at all

  // merge duplicates (same normalised token): keep reading order, best confidence
  const order: string[] = []
  const best = new Map<string, OcrWord>()
  for (const w of found) {
    const cur = best.get(w.normalized)
    if (!cur) { best.set(w.normalized, w); order.push(w.normalized) } else if (w.confidence > cur.confidence) best.set(w.normalized, w)
  }
  let words = order.map((k) => best.get(k) as OcrWord)
  // Latin and Arabic passes can both "read" the same glyphs; keep the script with the
  // higher confidence when readings compete heavily.
  const lat = words.filter((w) => w.script === 'latin')
  const ara = words.filter((w) => w.script === 'arabic')
  if (lat.length && ara.length) {
    const latC = Math.max(...lat.map((w) => w.confidence))
    const araC = Math.max(...ara.map((w) => w.confidence))
    if (latC >= CONFIDENT && araC < MIN_WORD_CONF + 10 && ara.length <= 1) words = words.filter((w) => w.script !== 'arabic')
    else if (araC >= CONFIDENT && latC < MIN_WORD_CONF + 10 && lat.length <= 1) words = words.filter((w) => w.script !== 'latin')
  }
  return done(words, passes, null)
}
