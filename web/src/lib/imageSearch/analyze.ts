/**
 * One image → recognised words + transliteration candidates, entirely in the
 * browser. This is the query-side half of "intelligent" Search by Image; the
 * stored images are analysed with the same steps by the Import Center indexer
 * (browser) or tools/image_index (offline Python), and both write to
 * public.trademark_image_analysis.
 */
import { ImageDecodeError } from './descriptor'
import { OCR_MODEL_VERSION, OcrUnavailableError, recogniseImage, type OcrOutcome, type RecogniseOptions } from './ocr'
import { loadImage, type LoadedImage } from './preprocess'
import { variantsFor, type Variant } from './textnorm'

export type ImageAnalysis = {
  image: { width: number; height: number; blank: boolean; content_box: number[] }
  ocr: OcrOutcome | null
  variants: Variant[]
  /** Always null in the browser pipeline: no visual embedding model ships to visitors. */
  embedding: null
  models: { ocr: string; embedding: null }
  warnings: string[]
  timings_ms: { ocr?: number; total: number }
}

export type AnalyseOptions = RecogniseOptions & { loaded?: LoadedImage }

/**
 * Throws ImageDecodeError for unreadable input. OCR failures are reported in
 * `warnings` ('ocr_failed') and `ocr.error`, never thrown — except when the
 * engine itself cannot start (OcrUnavailableError), which the caller treats as
 * "basic mode".
 */
export async function analyseImage(file: Blob, opts: AnalyseOptions = {}): Promise<ImageAnalysis> {
  const t0 = performance.now()
  const img = opts.loaded ?? (await loadImage(file))
  const out: ImageAnalysis = {
    image: { width: img.originalWidth, height: img.originalHeight, blank: img.blank, content_box: [...img.contentBox] },
    ocr: null,
    variants: [],
    embedding: null,
    models: { ocr: OCR_MODEL_VERSION, embedding: null },
    warnings: [],
    timings_ms: { total: 0 },
  }
  if (img.blank) out.warnings.push('blank')
  try {
    const r = await recogniseImage(img, opts)
    out.ocr = r
    out.timings_ms.ocr = r.duration_ms
    if (r.words.length) out.variants = variantsFor(r.words.map((w) => w.normalized))
    else if (!img.blank) out.warnings.push('no_text')
  } catch (e) {
    if (e instanceof OcrUnavailableError || e instanceof ImageDecodeError) throw e
    out.warnings.push('ocr_failed')
    out.ocr = { text: '', confidence: 0, scripts: [], uncertain: true, words: [], passes: 0, duration_ms: 0, engine: '', error: e instanceof Error ? e.name : 'Error' }
  }
  out.timings_ms.total = Math.round(performance.now() - t0)
  return out
}
