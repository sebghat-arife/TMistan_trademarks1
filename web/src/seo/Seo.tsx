import { useLayoutEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { applyHead, buildHead, ssrHead, type HeadState, type SeoProps } from './head'
import { splitLocalePath, type SiteLocaleCode } from './locales'

export type { SeoProps } from './head'

/**
 * Declare the metadata of the current page. Render exactly one per route.
 * Returns null — it only touches <head>.
 */
export function Seo(props: SeoProps) {
  const { pathname } = useLocation()
  const { i18n } = useTranslation()
  const { lng: urlLng, path: routePath } = splitLocalePath(pathname)
  const lng = (i18n.resolvedLanguage as SiteLocaleCode | undefined) ?? urlLng
  const state = buildHead(props, lng, routePath)
  if (import.meta.env.SSR) ssrHead.current = state
  const key = JSON.stringify(state)
  // Layout effect: the title/canonical are in place before paint and before analytics page views.
  useLayoutEffect(() => {
    applyHead(JSON.parse(key) as HeadState)
  }, [key])
  return null
}
