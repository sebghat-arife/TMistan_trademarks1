/**
 * Text normalisation, script detection and conservative transliteration
 * candidates for Search by Image — runs in the browser (query side) and is
 * mirrored by tools/image_index/textnorm.py (offline indexing). Keep the two
 * in step: the database owns the canonical normalisation (public.normalize_text);
 * this module only tokenises, classifies scripts and proposes *candidate*
 * spellings that the search treats as lower-weight "possible transliteration"
 * evidence. Nothing here is ever presented as a confirmed reading.
 */

export type Script = 'arabic' | 'latin' | 'digit' | 'other'

const ARABIC_RANGE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/
const LATIN_RANGE = /[A-Za-z\u00C0-\u024F]/
const DIGIT_RANGE = /[0-9\u0660-\u0669\u06F0-\u06F9]/
const DIACRITICS = /[\u064B-\u0652\u0670\u0640\u0610-\u061A\u06D6-\u06ED]/g
// Python's `\w` (Unicode) ≈ letters, digits, marks, underscore. Keep Arabic-block characters too.
const NOT_WORD = /[^\p{L}\p{N}_\u0600-\u06FF]+/gu
const COMBINING = /\p{M}/gu

const FOLD: Record<string, string> = {
  ي: 'ی', ك: 'ک', ة: 'ه', ۀ: 'ه', أ: 'ا', إ: 'ا', آ: 'ا', ؤ: 'و', ئ: 'ی',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
}
const FOLD_RE = new RegExp(`[${Object.keys(FOLD).join('')}]`, 'g')

/** Lower-cased, unaccented, diacritic-free, punctuation → space (close to the SQL function). */
export function normalizeText(text: string | null | undefined): string {
  let t = (text ?? '').normalize('NFKC')
  t = t.replace(DIACRITICS, '').replace(FOLD_RE, (c) => FOLD[c] ?? c)
  t = t.normalize('NFKD').replace(COMBINING, '')
  t = t.toLowerCase().replace(NOT_WORD, ' ')
  return t.replace(/\s+/g, ' ').trim()
}

export function scriptOf(token: string): Script {
  if (ARABIC_RANGE.test(token)) return 'arabic'
  if (LATIN_RANGE.test(token)) return 'latin'
  if (DIGIT_RANGE.test(token)) return 'digit'
  return 'other'
}

export function tokens(text: string): string[] {
  return normalizeText(text).split(' ').filter(Boolean)
}

const ARABIC_CHAR = /^[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF0-9]$/

/** Filter OCR noise: single letters, symbol salad, improbable consonant runs. */
export function plausibleToken(token: string, script: Script): boolean {
  if (script === 'digit') return token.length >= 2
  if (token.length < 2) return false
  if (script === 'latin') {
    let letters = 0
    for (const ch of token) if (/\p{L}/u.test(ch)) letters += 1
    if (letters < Math.max(2, Math.floor(token.length * 0.6))) return false
    if (token.length >= 4 && !/[aeiouy]/.test(token)) return token.length <= 5 // e.g. "xqtrn"
    if (/(.)\1\1\1/.test(token)) return false
    return true
  }
  if (script === 'arabic') {
    for (const ch of token) if (!ARABIC_CHAR.test(ch)) return false
    return token.length >= 2
  }
  return false
}

/* ------------------------------------------------------------------ Arabic script → Latin candidates */

// primary mapping + alternatives per letter (Dari/Pashto pronunciation, conservative)
const AR2LAT: Record<string, readonly string[]> = {
  ا: ['a', ''], ب: ['b'], پ: ['p'], ت: ['t'], ټ: ['t'], ث: ['s'], ج: ['j'], چ: ['ch'],
  ح: ['h'], خ: ['kh'], د: ['d'], ډ: ['d'], ذ: ['z'], ر: ['r'], ړ: ['r'], ز: ['z'],
  ژ: ['zh'], ږ: ['g', 'zh'], س: ['s'], ش: ['sh'], ښ: ['sh', 'kh'], ص: ['s'], ض: ['z'],
  ط: ['t'], ظ: ['z'], ع: ['', 'a'], غ: ['gh'], ف: ['f'], ق: ['q', 'k'], ک: ['k'],
  ګ: ['g'], گ: ['g'], ل: ['l'], م: ['m'], ن: ['n'], ڼ: ['n'], ه: ['h', 'a'],
  و: ['o', 'u', 'oo', 'w', 'ou'], ی: ['i', 'y', 'ee'], ې: ['e'], ۍ: ['ai', 'i'], ئ: ['i'],
  ء: [''], آ: ['a'],
}
const AMBIGUOUS = new Set(['و', 'ی', 'ق', 'ع', 'ښ', 'ږ'])

/**
 * Candidate Latin spellings for an Arabic-script token: the primary
 * transliteration, then the most ambiguous letters (و / ی / …) widened one at a
 * time. Distinct candidates, primary first.
 */
export function arabicToLatinVariants(token: string, limit = 6): string[] {
  const t = normalizeText(token)
  if (!t || scriptOf(t) !== 'arabic') return []
  const letters = Array.from(t)
  const primary: string[] = []
  letters.forEach((ch, i) => {
    const opts = AR2LAT[ch]
    if (opts === undefined) return
    if (ch === 'ا' && i === 0) primary.push('a')
    else if (ch === 'و' && i === 0) primary.push('w')
    else if (ch === 'ه' && i === letters.length - 1) primary.push(letters.length > 2 ? 'a' : 'h')
    else primary.push(opts[0])
  })
  const base = primary.join('')
  const out: string[] = []
  if (base.length >= 2) out.push(base)
  for (let i = 0; i < letters.length; i++) {
    const ch = letters[i]
    const alts = AR2LAT[ch] ?? []
    if (!AMBIGUOUS.has(ch) || alts.length <= 1) continue
    for (const alt of alts.slice(1)) {
      const cand = primary.slice()
      if (i < cand.length) cand[i] = alt
      const s = cand.join('')
      if (s.length >= 2 && !out.includes(s)) out.push(s)
      if (out.length >= limit) return out
    }
  }
  // common doubled-vowel spellings (nur → noor, amiri → ameeri) – keep it short
  for (const s of out.slice()) {
    for (const [a, b] of [['u', 'oo'], ['o', 'oo'], ['i', 'ee']] as const) {
      const v = s.replace(a, b)
      if (v !== s && !out.includes(v) && out.length < limit) out.push(v)
    }
  }
  return out.slice(0, limit)
}

/* ------------------------------------------------------------------ Latin → Arabic script skeleton */

const LAT2AR_MULTI: readonly (readonly [string, string])[] = [
  ['kh', 'خ'], ['gh', 'غ'], ['sh', 'ش'], ['ch', 'چ'], ['zh', 'ژ'], ['th', 'ت'], ['ph', 'ف'],
  ['oo', 'و'], ['ou', 'و'], ['ee', 'ی'], ['ck', 'ک'], ['qu', 'ک'],
]
const LAT2AR: Record<string, string> = {
  a: 'ا', b: 'ب', c: 'ک', d: 'د', e: '', f: 'ف', g: 'گ', h: 'ه', i: 'ی', j: 'ج',
  k: 'ک', l: 'ل', m: 'م', n: 'ن', o: 'و', p: 'پ', q: 'ق', r: 'ر', s: 'س', t: 'ت',
  u: 'و', v: 'و', w: 'و', x: 'کس', y: 'ی', z: 'ز',
}

function markMulti(s: string): string {
  for (const [a, b] of LAT2AR_MULTI) s = s.split(a).join(`<${b}>`)
  return s
}

/**
 * Consonant-skeleton candidates in Arabic script (short vowels dropped as in
 * Persian orthography; initial vowel kept as ا, final 'a'/'e' as ه).
 */
export function latinToArabicVariants(token: string, limit = 3): string[] {
  const t = normalizeText(token)
  // eslint-disable-next-line no-control-regex
  if (!t || scriptOf(t) !== 'latin' || !/^[\x00-\x7F]*$/.test(t)) return []
  const s = markMulti(t)
  const out: string[] = []
  const n = s.length
  for (let i = 0; i < n; i++) {
    const ch = s[i]
    if (ch === '<') {
      const j = s.indexOf('>', i)
      out.push(s.slice(i + 1, j))
      i = j
      continue
    }
    if ('aeiou'.includes(ch)) {
      if (i === 0) out.push(ch !== 'o' && ch !== 'u' ? 'ا' : 'او')
      else if (i === n - 1 && 'ae'.includes(ch)) out.push('ه')
      else if ('ou'.includes(ch)) out.push('و')
      else if (ch === 'i') out.push('ی')
      // short a / e inside the word are dropped
    } else {
      out.push(LAT2AR[ch] ?? '')
    }
  }
  const base = out.join('')
  const cands: string[] = base.length >= 2 ? [base] : []
  // second candidate keeps every 'a' as a long ا (common in brand transliterations: پامیر, سمندر)
  if (t.includes('a')) {
    const out2: string[] = []
    const s2 = markMulti(t)
    const n2 = s2.length
    for (let i = 0; i < n2; i++) {
      const ch = s2[i]
      if (ch === '<') {
        const j = s2.indexOf('>', i)
        out2.push(s2.slice(i + 1, j))
        i = j
        continue
      }
      if (ch === 'a') out2.push('ا')
      else if ('eiou'.includes(ch)) out2.push(ch === 'e' ? '' : ch === 'i' ? 'ی' : 'و')
      else out2.push(LAT2AR[ch] ?? '')
    }
    const withA = out2.join('')
    if (withA !== base && withA.length >= 2) cands.push(withA)
  }
  return cands.slice(0, limit)
}

export type Variant = { text: string; from: string; kind: 'transliteration'; script: Script }

/** Labelled candidate spellings for every recognised word (both directions). */
export function variantsFor(words: string[]): Variant[] {
  const out: Variant[] = []
  const seen = new Set<string>()
  for (const w of words) {
    const s = scriptOf(w)
    const cands = s === 'arabic' ? arabicToLatinVariants(w) : s === 'latin' ? latinToArabicVariants(w) : []
    for (const c of cands) {
      if (!seen.has(c) && c !== normalizeText(w)) {
        seen.add(c)
        out.push({ text: c, from: w, kind: 'transliteration', script: scriptOf(c) })
      }
    }
  }
  return out
}
