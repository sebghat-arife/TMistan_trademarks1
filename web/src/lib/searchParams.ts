import type { SearchTrademarksArgs } from './database.types'

/**
 * The URL is the single source of truth for search state so results are
 * shareable / bookmarkable: /search?q=nike&class=25&gazette=1011&page=2
 */
export interface SearchState {
  q: string
  mark: string
  applicant: string
  serial: string
  gazette: string
  classes: number[]
  goods: string
  type: string
  attorney: string
  from: string
  to: string
  fuzzy: boolean
  sort: NonNullable<SearchTrademarksArgs['p_sort']>
  view: 'grid' | 'table'
  page: number
  perPage: 20 | 50 | 100
}

export const DEFAULT_STATE: SearchState = {
  q: '',
  mark: '',
  applicant: '',
  serial: '',
  gazette: '',
  classes: [],
  goods: '',
  type: '',
  attorney: '',
  from: '',
  to: '',
  fuzzy: true,
  sort: 'relevance',
  view: 'grid',
  page: 1,
  perPage: 20,
}

const SORTS = new Set(['relevance', 'newest', 'oldest', 'mark_asc', 'mark_desc', 'serial'])

export function parseSearchParams(sp: URLSearchParams): SearchState {
  const perPageRaw = Number(sp.get('per') ?? 20)
  const perPage = ([20, 50, 100] as const).includes(perPageRaw as 20 | 50 | 100) ? (perPageRaw as 20 | 50 | 100) : 20
  const sort = sp.get('sort') ?? 'relevance'
  return {
    q: sp.get('q') ?? '',
    mark: sp.get('mark') ?? '',
    applicant: sp.get('applicant') ?? '',
    serial: sp.get('serial') ?? '',
    gazette: sp.get('gazette') ?? '',
    classes: (sp.get('class') ?? '')
      .split(',')
      .map((s) => Number(s))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 45),
    goods: sp.get('goods') ?? '',
    type: sp.get('type') ?? '',
    attorney: sp.get('attorney') ?? '',
    from: sp.get('from') ?? '',
    to: sp.get('to') ?? '',
    fuzzy: sp.get('fuzzy') !== '0',
    sort: (SORTS.has(sort) ? sort : 'relevance') as SearchState['sort'],
    view: sp.get('view') === 'table' ? 'table' : 'grid',
    page: Math.max(1, Number(sp.get('page') ?? 1) || 1),
    perPage,
  }
}

export function toSearchParams(s: SearchState): URLSearchParams {
  const sp = new URLSearchParams()
  const set = (k: string, v: string | number | boolean | null | undefined, def?: string | number | boolean) => {
    if (v === null || v === undefined || v === '' || v === def) return
    sp.set(k, String(v))
  }
  set('q', s.q.trim())
  set('mark', s.mark.trim())
  set('applicant', s.applicant.trim())
  set('serial', s.serial.trim())
  set('gazette', s.gazette.trim())
  if (s.classes.length) sp.set('class', [...s.classes].sort((a, b) => a - b).join(','))
  set('goods', s.goods.trim())
  set('type', s.type.trim())
  set('attorney', s.attorney.trim())
  set('from', s.from)
  set('to', s.to)
  if (!s.fuzzy) sp.set('fuzzy', '0')
  set('sort', s.sort, 'relevance')
  set('view', s.view, 'grid')
  set('page', s.page, 1)
  set('per', s.perPage, 20)
  return sp
}

export function toRpcArgs(s: SearchState): SearchTrademarksArgs {
  const nz = (v: string) => (v.trim() === '' ? null : v.trim())
  return {
    p_query: nz(s.q),
    p_mark: nz(s.mark),
    p_applicant: nz(s.applicant),
    p_serial: nz(s.serial),
    p_gazette: nz(s.gazette),
    p_classes: s.classes.length ? s.classes : null,
    p_goods: nz(s.goods),
    p_application_type: nz(s.type),
    p_attorney: nz(s.attorney),
    p_date_from: nz(s.from),
    p_date_to: nz(s.to),
    p_fuzzy: s.fuzzy,
    p_sort: s.sort,
    p_limit: s.perPage,
    p_offset: (s.page - 1) * s.perPage,
  }
}

export function countActiveFilters(s: SearchState): number {
  let n = 0
  for (const k of ['mark', 'applicant', 'serial', 'gazette', 'goods', 'type', 'attorney', 'from', 'to'] as const) {
    if (s[k].trim() !== '') n++
  }
  if (s.classes.length) n++
  return n
}

export function hasAnyCriteria(s: SearchState): boolean {
  return s.q.trim() !== '' || countActiveFilters(s) > 0
}
