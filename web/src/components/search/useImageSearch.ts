import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  IMAGE_SEARCH_EXACT_MIN_SIMILARITY,
  IMAGE_SEARCH_LIMIT,
  IMAGE_SEARCH_MAX_LIMIT,
  IMAGE_SEARCH_MIN_SIMILARITY,
  imageSearchStatusQuery,
  searchTrademarksByDescriptor,
  type ImageSearchExample,
  type ImageSearchResult,
} from '@/services'
import { ImageDecodeError, describeImage, validateQueryFile } from '@/lib/imageSearch/descriptor'

/**
 * State machine behind "Search by Image".
 *
 * The picture is decoded and reduced to a visual descriptor in the browser
 * (lib/imageSearch/descriptor.ts); only that vector goes to the database
 * function `search_trademarks_by_image`. The three options map onto what the
 * backend genuinely supports:
 *   exact    → same descriptor search with a strict similarity cut-off
 *   similar  → the calibrated default cut-off
 *   advanced → default cut-off, larger candidate set, then class / gazette /
 *              application-type filters applied to the records returned
 */

export type ImageSearchOption = 'exact' | 'similar' | 'advanced'
export type ImageRefine = { classes: number[]; gazette: string; type: string }
export type ImagePhase = 'idle' | 'loading-example' | 'analysing' | 'searching' | 'done'
export type ImageErrorKind = 'invalidType' | 'tooLarge' | 'decode' | 'failed' | 'example' | null
export type ImageSource = { kind: 'upload' } | { kind: 'example'; serial: string; trademarkId: string }

export const EMPTY_REFINE: ImageRefine = { classes: [], gazette: '', type: '' }

export function useImageSearch(enabled = true) {
  const status = useQuery({ ...imageSearchStatusQuery(), enabled })
  const available = status.data?.available ?? false

  const [file, setFile] = useState<File | null>(null)
  const [source, setSource] = useState<ImageSource>({ kind: 'upload' })
  const [option, setOption] = useState<ImageSearchOption>('similar')
  const [refine, setRefine] = useState<ImageRefine>(EMPTY_REFINE)
  const [phase, setPhase] = useState<ImagePhase>('idle')
  const [errorKind, setErrorKind] = useState<ImageErrorKind>(null)
  const [errorDetail, setErrorDetail] = useState<string | null>(null)
  const [results, setResults] = useState<ImageSearchResult[] | null>(null)
  const [searchedWith, setSearchedWith] = useState<ImageSearchOption>('similar')
  const runRef = useRef(0)

  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  const invalidate = () => { runRef.current += 1 }

  const reset = useCallback(() => {
    invalidate()
    setFile(null)
    setSource({ kind: 'upload' })
    setResults(null)
    setPhase('idle')
    setErrorKind(null)
    setErrorDetail(null)
  }, [])

  /** Validate and select a file (from the picker, a drop, or an example). Returns false when rejected. */
  const choose = useCallback((f: File | null | undefined, src: ImageSource = { kind: 'upload' }): boolean => {
    if (!f) return false
    invalidate()
    setResults(null)
    setPhase('idle')
    setErrorDetail(null)
    const v = validateQueryFile(f)
    if (v !== 'ok') {
      setFile(null)
      setSource({ kind: 'upload' })
      setErrorKind(v === 'size' ? 'tooLarge' : 'invalidType')
      return false
    }
    setErrorKind(null)
    setFile(f)
    setSource(src)
    return true
  }, [])

  const search = useCallback(async (f: File, opt: ImageSearchOption) => {
    const token = ++runRef.current
    setErrorKind(null)
    setErrorDetail(null)
    setResults(null)
    setPhase('analysing')
    try {
      const descriptor = await describeImage(f)
      if (token !== runRef.current) return
      setPhase('searching')
      const rows = await searchTrademarksByDescriptor(
        descriptor,
        opt === 'advanced' ? IMAGE_SEARCH_MAX_LIMIT : IMAGE_SEARCH_LIMIT,
        opt === 'exact' ? IMAGE_SEARCH_EXACT_MIN_SIMILARITY : IMAGE_SEARCH_MIN_SIMILARITY,
      )
      if (token !== runRef.current) return
      setResults(rows)
      setSearchedWith(opt)
      setPhase('done')
    } catch (e) {
      if (token !== runRef.current) return
      setPhase('idle')
      if (e instanceof ImageDecodeError) setErrorKind('decode')
      else {
        setErrorKind('failed')
        setErrorDetail(e instanceof Error ? e.message : String(e))
      }
    }
  }, [])

  const busy = phase === 'analysing' || phase === 'searching' || phase === 'loading-example'

  /** Submit: guarded against double submission and against running without a valid image. */
  const run = useCallback(() => {
    if (!file || !available || busy) return
    void search(file, option)
  }, [file, available, busy, option, search])

  /** Fetch a published trademark image from Storage and search with it. */
  const useExample = useCallback(async (ex: ImageSearchExample) => {
    if (!available || busy) return
    const token = ++runRef.current
    setErrorKind(null)
    setErrorDetail(null)
    setResults(null)
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
      if (!choose(f, src)) return
      await search(f, option)
    } catch (e) {
      if (token !== runRef.current) return
      setPhase('idle')
      setErrorKind('example')
      setErrorDetail(e instanceof Error ? e.message : String(e))
    }
  }, [available, busy, option, choose, search])

  /** Results after the "advanced" refinement (no-op for the other options). */
  const filtered = useMemo(() => {
    if (!results) return null
    if (searchedWith !== 'advanced') return results
    return results.filter((r) => {
      if (refine.classes.length && !(r.class_numbers ?? []).some((c) => refine.classes.includes(c))) return false
      if (refine.gazette && r.official_gazette_number !== refine.gazette) return false
      if (refine.type && (r.application_type ?? '').toLowerCase() !== refine.type.toLowerCase()) return false
      return true
    })
  }, [results, refine, searchedWith])

  return {
    status,
    available,
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
    results,
    filtered,
    searchedWith,
    choose,
    reset,
    run,
    useExample,
  }
}

export type ImageSearchController = ReturnType<typeof useImageSearch>
