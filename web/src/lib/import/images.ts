/**
 * Image intake for the Admin Import Center — runs in the browser.
 *
 *   files / ZIP archives  →  ImageCandidate[] (validated bytes + serial key)
 *
 * The serial number is derived ONLY from the file name without its extension
 * (e.g. "1011-002.png" → "1011-002"). Folder names inside a ZIP are ignored
 * for matching but kept for the report. Nothing is uploaded here.
 */
import type { Unzipped } from 'fflate'
import { cleanSerial } from './serial'

export const IMAGE_EXT = /\.(jpe?g|png|webp|gif|tiff?)$/i
export const ZIP_EXT = /\.zip$/i
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024 // bucket limit (scripts/setup_storage.py)
export const MAX_ZIP_BYTES = 500 * 1024 * 1024
export const MAX_ZIP_ENTRIES = 5000

export interface ImageCandidate {
  /** Stable id within one intake batch. */
  key: string
  /** Original file name (inside the ZIP when applicable). */
  fileName: string
  /** ZIP name or null for a directly dropped file. */
  archive: string | null
  /** Folder inside the archive ("" for root). */
  folder: string
  /** File name without extension, trimmed. */
  stem: string
  /** Canonical serial text derived from `stem` (whitespace/dash normalised; digits ASCII). */
  serial: string | null
  bytes: Uint8Array
  size: number
  contentType: string
  ext: string
  sha256: string
  width: number | null
  height: number | null
}

export interface InvalidFile {
  fileName: string
  archive: string | null
  reason: string
}

export interface IntakeResult {
  candidates: ImageCandidate[]
  invalid: InvalidFile[]
  /** Same bytes (sha256) appearing under different names. */
  duplicateContent: { sha256: string; fileNames: string[] }[]
  /** Same serial appearing under different files (e.g. 1011-002.png + 1011-002.jpg). */
  duplicateSerials: { serial: string; fileNames: string[] }[]
}

export function isImageFile(name: string): boolean {
  return IMAGE_EXT.test(name)
}
export function isZipFile(name: string): boolean {
  return ZIP_EXT.test(name)
}

/** Sniff the real content type from the first bytes; never trust the extension alone. */
export function sniffImageType(b: Uint8Array): string | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif'
  if (b.length >= 4 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a))) return 'image/tiff'
  return null
}

const EXT_FOR_TYPE: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/tiff': 'tif' }

export function stemOf(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName
  return base.replace(/\.[^.]+$/, '').trim()
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('')
}

async function dimensions(bytes: Uint8Array, type: string): Promise<{ width: number | null; height: number | null }> {
  if (type === 'image/tiff' || typeof createImageBitmap !== 'function') return { width: null, height: null }
  try {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type }))
    const out = { width: bmp.width, height: bmp.height }
    bmp.close()
    return out
  } catch {
    return { width: null, height: null }
  }
}

/**
 * Unzip only the entries worth looking at: image names, not macOS metadata,
 * not larger than the bucket limit. Everything else is reported without
 * being decompressed, which keeps memory bounded for big archives.
 */
async function unzipAsync(data: Uint8Array, skipped: { name: string; reason: string }[]): Promise<Unzipped> {
  const { unzip } = await import('fflate') // loaded on demand
  return new Promise((resolve, reject) => {
    unzip(
      data,
      {
        filter: (f) => {
          if (f.name.endsWith('/')) return false
          const base = f.name.split('/').pop() ?? f.name
          if (base.startsWith('.') || f.name.startsWith('__MACOSX/') || base === 'Thumbs.db') return false
          if (!isImageFile(base)) {
            skipped.push({ name: f.name, reason: 'Not an image (JPG, PNG, WEBP, GIF, TIFF)' })
            return false
          }
          if (f.originalSize > MAX_IMAGE_BYTES) {
            skipped.push({ name: f.name, reason: `Larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB` })
            return false
          }
          return true
        },
      },
      (err, out) => (err ? reject(err) : resolve(out)),
    )
  })
}

/**
 * Turn dropped files (images and/or ZIP archives) into validated candidates.
 * `onProgress(done, total)` is called per processed entry.
 */
export async function intakeImages(files: File[], onProgress?: (done: number, total: number) => void): Promise<IntakeResult> {
  const invalid: InvalidFile[] = []
  const entries: { name: string; archive: string | null; folder: string; bytes: Uint8Array }[] = []

  for (const f of files) {
    if (isZipFile(f.name)) {
      if (f.size > MAX_ZIP_BYTES) {
        invalid.push({ fileName: f.name, archive: null, reason: `ZIP larger than ${MAX_ZIP_BYTES / 1024 / 1024} MB` })
        continue
      }
      let unz: Unzipped
      const skipped: { name: string; reason: string }[] = []
      try {
        unz = await unzipAsync(new Uint8Array(await f.arrayBuffer()), skipped)
      } catch (e) {
        invalid.push({ fileName: f.name, archive: null, reason: `Cannot read ZIP: ${(e as Error).message}` })
        continue
      }
      for (const sk of skipped) invalid.push({ fileName: sk.name, archive: f.name, reason: sk.reason })
      const names = Object.keys(unz)
      if (names.length > MAX_ZIP_ENTRIES) {
        invalid.push({ fileName: f.name, archive: null, reason: `ZIP has more than ${MAX_ZIP_ENTRIES} image entries` })
        continue
      }
      for (const name of names) {
        const base = name.split('/').pop() ?? name
        const folder = name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : ''
        entries.push({ name: base, archive: f.name, folder, bytes: unz[name] })
      }
    } else if (isImageFile(f.name)) {
      entries.push({ name: f.name, archive: null, folder: '', bytes: new Uint8Array(await f.arrayBuffer()) })
    } else {
      invalid.push({ fileName: f.name, archive: null, reason: 'Unsupported file type (use JPG, PNG, WEBP or a ZIP of images)' })
    }
  }

  const candidates: ImageCandidate[] = []
  let done = 0
  for (const e of entries) {
    done++
    onProgress?.(done, entries.length)
    if (e.bytes.length === 0) {
      invalid.push({ fileName: e.name, archive: e.archive, reason: 'Empty file' })
      continue
    }
    if (e.bytes.length > MAX_IMAGE_BYTES) {
      invalid.push({ fileName: e.name, archive: e.archive, reason: `Larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB` })
      continue
    }
    const type = sniffImageType(e.bytes)
    if (!type) {
      invalid.push({ fileName: e.name, archive: e.archive, reason: 'File content is not a valid image' })
      continue
    }
    const stem = stemOf(e.name)
    const serial = cleanSerial(stem)
    const [sha256, dims] = await Promise.all([sha256Hex(e.bytes), dimensions(e.bytes, type)])
    candidates.push({
      key: `${e.archive ?? ''}::${e.folder}/${e.name}`,
      fileName: e.name,
      archive: e.archive,
      folder: e.folder,
      stem,
      serial,
      bytes: e.bytes,
      size: e.bytes.length,
      contentType: type,
      ext: EXT_FOR_TYPE[type] ?? 'bin',
      sha256,
      width: dims.width,
      height: dims.height,
    })
  }

  // Duplicates by content
  const byHash = new Map<string, string[]>()
  for (const c of candidates) byHash.set(c.sha256, [...(byHash.get(c.sha256) ?? []), c.fileName])
  const duplicateContent = [...byHash.entries()].filter(([, v]) => v.length > 1).map(([sha256, fileNames]) => ({ sha256, fileNames }))
  // Duplicates by serial (different files for the same serial)
  const bySerial = new Map<string, string[]>()
  for (const c of candidates) if (c.serial) bySerial.set(c.serial, [...(bySerial.get(c.serial) ?? []), c.fileName])
  const duplicateSerials = [...bySerial.entries()].filter(([, v]) => v.length > 1).map(([serial, fileNames]) => ({ serial, fileNames }))

  return { candidates, invalid, duplicateContent, duplicateSerials }
}
