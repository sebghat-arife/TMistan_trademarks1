import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  IMAGE_SEARCH_EXACT_MIN_SIMILARITY,
  IMAGE_SEARCH_LIMIT,
  IMAGE_SEARCH_MAX_LIMIT,
  IMAGE_SEARCH_MIN_SIMILARITY,
  HYBRID_DEFAULTS,
  MigrationMissingError,
  VisionError,
  analyzeImage,
  hybridStatusQuery,
  imageSearchStatusQuery,
  searchTrademarksByDescriptor,
  searchTrademarksHybrid,
  visionConfigured,
  visionHealthQuery,
  type HybridMatchType,
  type HybridResult,
  type ImageSearchExample,
  type ImageSearchResult,
  type VisionAnalysis,
  type VisionWord,
} from '@/services'
import { DESCRIPTOR_VERSION, ImageDecodeError, describeImage, toVector, validateQueryFile, type Descriptor } from '@/lib/imageSearch/descriptor'

/**
 * State machine behind "Search by Image".
 *
 *   choose file ─▶ analysing ─▶ ready (recognised words shown, editable) ─▶ searching ─▶ done
 *
 * Intelligent mode (vision service configured + reachable, migration 1200 applied):
 *   the picture is sent to the TMistan vision service, which returns the words
 *   it recognised (with confidence), conservative transliteration variants and
 *   a CLIP embedding; the browser also computes the 0500 descriptor. All of it
 *   goes to `search_trademarks_hybrid`, which ranks by text + visual evidence.
 *
 * Basic mode (anything above missing): the 0500 descriptor search only, and the
 * UI says so — nothing is ever presented as "AI" when it did not run.
 *
 * The three options keep their meaning:
 *   exact    → identical / near-identical images only
 *   similar  → the full ranking (text, visual, combined)
 *   advanced → the full ranking + class / gazette / application-type filters
 */

export type ImageSearchOption = 'exact' | 'similar' | 'advanced'
export type ImageRefine = { classes: number[]; gazette: string; type: string }
export type ImagePhase = 'idle' | 'loading-example' | 'analysing' | 'ready' | 'searching' | 'done'
export type ImageErrorKind = 'invalidType' | 'tooLarge' | 'decode' | 'failed' | 'example' | 'blank' | 'rateLimited' | 'timeout' | null
export type ImageSource = { kind: 'upload' } | { kind: 'example'; serial: string; trademarkId: string }
export type SearchMode = 'intelligent' | 'basic'
/** Why the search ran (or will run) in basic mode. */
export type BasicReason = 'not_configured' | 'service_unreachable' | 'migration_missing' | 'index_empty' | null
/** Grouping shown in the results: one primary label per record. */
export type MatchGroup = 'text' | 'variant' | 'visual' | 'symbol'
export type MatchFilter = 'all' | MatchGroup

export const EMPTY_REFINE: ImageRefine = { classes: [], gazette: '', type: '' }

/** One result row of either mode, normalised for the UI. */
export type UnifiedResult = ImageSearchResult & {
  mode: SearchMode
  group: MatchGroup
  text_score: number
  visual_score: number
  combined_score: number
  match_types: HybridMatchType[]
  reasons: HybridResult['reasons']
  matched_text: string | null
}

export type Recognition = {
  /** Editable wording the search will use (the visitor may change it). */
  text: string
  /** What OCR produced, untouched, for reference. */
  original: string
  confidence: number
  uncertain: boolean
  scripts: string[]
  words: VisionWord[]
  variants: VisionAnalysis['variants']
  /** Whether transliteration variants are included in the search. */
  useVariants: boolean
  blank: boolean
  warnings: string[]
  models: VisionAnalysis['models']
  embedding: number[] | null
  durationMs: number
}

export function groupOf(types: HybridMatchType[]): MatchGroup {
  if (types.includes('text_exact')) return 'text'
  if (types.includes('ocr_text') && !types.includes('text_fuzzy') && !types.includes('variant') && !types.includes('phonetic')) return 'text'
  if (types.includes('text_fuzzy') || types.includes('variant') || types.includes('phonetic')) return 'variant'
  if (types.includes('near_duplicate') || types.includes('visual_high')) return 'visual'
  return 'symbol'
}

function splitWords(text: string): string[] {
  return text
    .split(/[\s,;/|]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2)
    .slice(0, 12)
}

/** The 0500 descriptor search, normalised to the unified result shape (basic mode). */
async function basicSearch(descriptor: Descriptor | null, opt: ImageSearchOption): Promise<UnifiedResult[]> {
  if (!descriptor) throw new ImageDecodeError()
  const rows = await searchTrademarksByDescriptor(
    descriptor,
    opt === 'advanced' ? IMAGE_SEARCH_MAX_LIMIT : IMAGE_SEARCH_LIMIT,
    opt === 'exact' ? IMAGE_SEARCH_EXACT_MIN_SIMILARITY : IMAGE_SEARCH_MIN_SIMILARITY,
  )
  return rows.map((r) => ({
    ...r,
    mode: 'basic' as const,
    group: (r.similarity >= 0.8 ? 'visual' : 'symbol') as MatchGroup,
    text_score: 0,
    visual_score: r.similarity,
    combined_score: r.similarity,
    match_types: (r.similarity >= IMAGE_SEARCH_EXACT_MIN_SIMILARITY ? ['near_duplicate'] : ['visual']) as HybridMatchType[],
    reasons: { duplicate: { similarity: r.similarity } },
    matched_text: null,
  }))
}

export function useImageSearch(enabled = true) {
  const v1Status = useQuery({ ...imageSearchStatusQuery(), enabled })
  const hybridStatus = useQuery({ ...hybridStatusQuery(), enabled })
  const health = useQuery({ ...visionHealthQuery(), enabled: enabled && visionConfigured })

  const v1Available = v1Status.data?.available ?? false
  const hybridInstalled = hybridStatus.data ? hybridStatus.data.state !== 'not_installed' : false
  const hybridReady = hybridStatus.data?.state === 'ready'
  const serviceUp = visionConfigured && health.isSuccess && health.data.ok
  const serviceDown = visionConfigured && (health.isError || (health.isSuccess && !health.data.ok))

  /** Which mode a search started now would use, and why not the better one. */
  const mode: SearchMode = serviceUp && hybridReady ? 'intelligent' : 'basic'
  const basicReason: BasicReason = mode === 'intelligent' ? null : !visionConfigured ? 'not_configured' : serviceDown || health.isPending ? 'service_unreachable' : !hybridInstalled ? 'migration_missing' : 'index_empty'
  /** Text-only search through the database is possible even without the service (manual words). */
  const textSearchAvailable = hybridInstalled
  const available = v1Available || hybridReady

  const [file, setFile] = useState<File | null>(null)
  const [source, setSource] = useState<ImageSource>({ kind: 'upload' })
  const [option, setOption] = useState<ImageSearchOption>('similar')
  const [refine, setRefine] = useState<ImageRefine>(EMPTY_REFINE)
  const [phase, setPhase] = useState<ImagePhase>('idle')
  const [errorKind, setErrorKind] = useState<ImageErrorKind>(null)
  const [errorDetail, setErrorDetail] = useState<string | null>(null)
  const [recognition, setRecognition] = useState<Recognition | null>(null)
  const [analysisNotice, setAnalysisNotice] = useState<'ocr_failed' | 'service_failed' | null>(null)
  const [results, setResults] = useState<UnifiedResult[] | null>(null)
  const [searchedWith, setSearchedWith] = useState<ImageSearchOption>('similar')
  const [searchedMode, setSearchedMode] = useState<SearchMode>('basic')
  const [searchedTerms, setSearchedTerms] = useState<string[]>([])
  const [searchedModalities, setSearchedModalities] = useState<{ text: boolean; visual: boolean; duplicate: boolean }>({ text: false, visual: false, duplicate: false })
  const [matchFilter, setMatchFilter] = useState<MatchFilter>('all')
  const runRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  const invalidate = () => {
    runRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
  }

  const reset = useCallback(() => {
    invalidate()
    setFile(null)
    setSource({ kind: 'upload' })
    setResults(null)
    setRecognition(null)
    setAnalysisNotice(null)
    setPhase('idle')
    setErrorKind(null)
    setErrorDetail(null)
    setMatchFilter('all')
  }, [])

  /** Step 1 — send the picture to the vision service; produces the editable recognition block. */
  const analyse = useCallback(async (f: File, token: number): Promise<Recognition | null> => {
    if (!(visionConfigured && hybridInstalled)) return null
    const ctl = new AbortController()
    abortRef.current = ctl
    try {
      const a = await analyzeImage(f, { signal: ctl.signal })
      if (token !== runRef.current) return null
      const ocr = a.ocr
      const confident = (ocr?.words ?? []).filter((w) => w.confidence >= 60)
      const text = (confident.length ? confident : ocr?.words ?? []).map((w) => w.text).join(' ')
      const rec: Recognition = {
        text,
        original: ocr?.text ?? '',
        confidence: ocr?.confidence ?? 0,
        uncertain: ocr?.uncertain ?? true,
        scripts: ocr?.scripts ?? [],
        words: ocr?.words ?? [],
        variants: a.variants ?? [],
        useVariants: true,
        blank: !!a.image?.blank,
        warnings: a.warnings ?? [],
        models: a.models,
        embedding: a.embedding,
        durationMs: a.timings_ms?.total ?? 0,
      }
      setRecognition(rec)
      setAnalysisNotice(ocr?.error && ocr.error !== 'blank' ? 'ocr_failed' : null)
      return rec
    } catch (e) {
      if (token !== runRef.current) return null
      if (e instanceof VisionError) {
        if (e.code === 'rate_limited') { setErrorKind('rateLimited'); setErrorDetail(e.message); return null }
        if (e.code === 'timeout') { setErrorKind('timeout'); setErrorDetail(e.message); return null }
        if (e.code === 'empty' || e.code === 'corrupt' || e.code === 'unsupported' || e.code === 'too_small') { setErrorKind('decode'); setErrorDetail(e.message); return null }
        if (e.code === 'too_large') { setErrorKind('tooLarge'); setErrorDetail(e.message); return null }
      }
      // service unreachable / server error → continue in basic mode and say so
      setAnalysisNotice('service_failed')
      setRecognition(null)
      return null
    } finally {
      if (abortRef.current === ctl) abortRef.current = null
    }
  }, [hybridInstalled])

  /** Validate and select a file (from the picker, a drop, or an example); then analyse it. Returns false when rejected. */
  const choose = useCallback((f: File | null | undefined, src: ImageSource = { kind: 'upload' }): boolean => {
    if (!f) return false
    invalidate()
    setResults(null)
    setRecognition(null)
    setAnalysisNotice(null)
    setMatchFilter('all')
    setErrorDetail(null)
    const v = validateQueryFile(f)
    if (v !== 'ok') {
      setFile(null)
      setSource({ kind: 'upload' })
      setPhase('idle')
      setErrorKind(v === 'size' ? 'tooLarge' : 'invalidType')
      return false
    }
    setErrorKind(null)
    setFile(f)
    setSource(src)
    if (visionConfigured && hybridInstalled && !serviceDown) {
      const token = ++runRef.current
      setPhase('analysing')
      void analyse(f, token).then((rec) => {
        if (token !== runRef.current) return
        setPhase('ready')
        if (rec?.blank) setErrorKind('blank')
      })
    } else {
      setPhase('ready')
    }
    return true
  }, [analyse, hybridInstalled, serviceDown])

  /** Step 2 — run the search with whatever evidence is available. */
  const search = useCallback(async (f: File, opt: ImageSearchOption, rec: Recognition | null) => {
    const token = ++runRef.current
    setErrorKind(null)
    setErrorDetail(null)
    setResults(null)
    setMatchFilter('all')
    setPhase('searching')
    try {
      let descriptor: Descriptor | null = null
      try {
        descriptor = await describeImage(f)
      } catch (e) {
        if (e instanceof ImageDecodeError && !rec?.embedding) throw e
      }
      if (token !== runRef.current) return
      const terms = rec && !rec.blank ? splitWords(rec.text) : []
      const variants = rec?.useVariants ? rec.variants.map((v) => v.text) : []
      const intelligent = !!rec && hybridInstalled && (!!rec.embedding || terms.length > 0)
      const useFilters = opt === 'advanced'
      let rows: UnifiedResult[]
      let usedMode: SearchMode = 'basic'
      let modalities = { text: false, visual: false, duplicate: false }
      if (intelligent || (hybridInstalled && terms.length > 0)) {
        try {
          const hits = await searchTrademarksHybrid({
            embedding: rec?.embedding ?? null,
            modelVersion: rec?.models.embedding ?? null,
            terms,
            variants,
            descriptor: descriptor ? toVector(descriptor) : null,
            descriptorVersion: DESCRIPTOR_VERSION,
            classes: useFilters ? refine.classes : [],
            gazette: useFilters ? refine.gazette : '',
            applicationType: useFilters ? refine.type : '',
            limit: useFilters ? HYBRID_DEFAULTS.maxLimit : HYBRID_DEFAULTS.limit,
            minVisual: opt === 'exact' ? 0.95 : HYBRID_DEFAULTS.minVisual,
          })
          usedMode = 'intelligent'
          modalities = { text: terms.length > 0 || variants.length > 0, visual: !!rec?.embedding, duplicate: !!descriptor }
          rows = hits
            .filter((h) => (opt === 'exact' ? h.match_types.includes('near_duplicate') : true))
            .map((h) => ({ ...h, similarity: h.combined_score, matched_image_id: h.matched_image_id ?? '', mode: 'intelligent' as const, group: groupOf(h.match_types) }))
        } catch (e) {
          if (!(e instanceof MigrationMissingError)) throw e
          rows = await basicSearch(descriptor, opt)
          modalities = { text: false, visual: false, duplicate: true }
        }
      } else {
        rows = await basicSearch(descriptor, opt)
        modalities = { text: false, visual: false, duplicate: true }
      }
      if (token !== runRef.current) return
      setResults(rows)
      setSearchedWith(opt)
      setSearchedMode(usedMode)
      setSearchedTerms(terms)
      setSearchedModalities(modalities)
      setPhase('done')
    } catch (e) {
      if (token !== runRef.current) return
      setPhase('ready')
      if (e instanceof ImageDecodeError) setErrorKind('decode')
      else {
        setErrorKind('failed')
        setErrorDetail(e instanceof Error ? e.message : String(e))
      }
    }
  }, [hybridInstalled, refine])

  const busy = phase === 'analysing' || phase === 'searching' || phase === 'loading-example'

  /** Submit: guarded against double submission and against running without a valid image. */
  const run = useCallback(() => {
    if (!file || !available || busy) return
    void search(file, option, recognition)
  }, [file, available, busy, option, recognition, search])

  /** Re-run text recognition (after a service hiccup). */
  const reanalyse = useCallback(() => {
    if (!file || busy) return
    const token = ++runRef.current
    setErrorKind(null)
    setErrorDetail(null)
    setAnalysisNotice(null)
    setPhase('analysing')
    void analyse(file, token).then((rec) => {
      if (token !== runRef.current) return
      setPhase('ready')
      if (rec?.blank) setErrorKind('blank')
    })
  }, [file, busy, analyse])

  const setRecognisedText = useCallback((text: string) => {
    setRecognition((r) => (r ? { ...r, text } : { text, original: '', confidence: 0, uncertain: true, scripts: [], words: [], variants: [], useVariants: false, blank: false, warnings: [], models: { ocr: null, embedding: null }, embedding: null, durationMs: 0 }))
  }, [])
  const setUseVariants = useCallback((on: boolean) => setRecognition((r) => (r ? { ...r, useVariants: on } : r)), [])

  /** Fetch a published trademark image from Storage and search with it. */
  const useExample = useCallback(async (ex: ImageSearchExample) => {
    if (!available || busy) return
    const token = ++runRef.current
    setErrorKind(null)
    setErrorDetail(null)
    setResults(null)
    setRecognition(null)
    setPhase('loading-example')
    try {
      const res = await fetch(ex.url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      if (token !== runRef.current) return
      const ext = (ex.image.storage_path.split('.').pop() || 'png').toLowerCase()
      const type = blob.type || (ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png')
      const f = new File([blob], `${ex.trademark.serial_number}.${ext}`, { type })
      const src: ImageSource = { kind: 'example', serial: ex.trademark.serial_number, trademarkId: ex.trademark.id }
      const v = validateQueryFile(f)
      if (v !== 'ok') { setErrorKind(v === 'size' ? 'tooLarge' : 'invalidType'); setPhase('idle'); return }
      setFile(f)
      setSource(src)
      let rec: Recognition | null = null
      if (visionConfigured && hybridInstalled && !serviceDown) {
        const t2 = ++runRef.current
        setPhase('analysing')
        rec = await analyse(f, t2)
        if (t2 !== runRef.current) return
      }
      await search(f, option, rec)
    } catch (e) {
      if (token !== runRef.current) return
      setPhase('idle')
      setErrorKind('example')
      setErrorDetail(e instanceof Error ? e.message : String(e))
    }
  }, [available, busy, option, hybridInstalled, serviceDown, analyse, search])

  /** Results after the match-type filter (and, in basic "advanced" mode, the client-side refinement). */
  const filtered = useMemo(() => {
    if (!results) return null
    let rows = results
    if (searchedMode === 'basic' && searchedWith === 'advanced') {
      rows = rows.filter((r) => {
        if (refine.classes.length && !(r.class_numbers ?? []).some((c) => refine.classes.includes(c))) return false
        if (refine.gazette && r.official_gazette_number !== refine.gazette) return false
        if (refine.type && (r.application_type ?? '').toLowerCase() !== refine.type.toLowerCase()) return false
        return true
      })
    }
    if (matchFilter !== 'all') rows = rows.filter((r) => r.group === matchFilter)
    return rows
  }, [results, refine, searchedWith, searchedMode, matchFilter])

  const groupCounts = useMemo(() => {
    const counts: Record<MatchGroup, number> = { text: 0, variant: 0, visual: 0, symbol: 0 }
    for (const r of results ?? []) counts[r.group] += 1
    return counts
  }, [results])

  return {
    status: v1Status,
    hybridStatus,
    health,
    available,
    mode,
    basicReason,
    textSearchAvailable,
    file,
    source,
    previewUrl,
    option,
    setOption,
    refine,
    setRefine,
    phase,
    busy,
    errorKind,
    errorDetail,
    recognition,
    analysisNotice,
    setRecognisedText,
    setUseVariants,
    reanalyse,
    results,
    filtered,
    groupCounts,
    matchFilter,
    setMatchFilter,
    searchedWith,
    searchedMode,
    searchedTerms,
    searchedModalities,
    choose,
    reset,
    run,
    useExample,
  }
}

export type ImageSearchController = ReturnType<typeof useImageSearch>
