import type { Plugin } from 'vite'

/**
 * Google Tag Manager — the consent-first loader lives in index.html between the
 * `<!--gtm:head-->…<!--/gtm:head-->` markers (Consent Mode defaults + the official container snippet,
 * executed only while analytics consent is granted — docs/ANALYTICS.md), so that every prerendered
 * page and the SPA shell (both derived from that template) carry it. There is deliberately no
 * `<noscript>` iframe: without JavaScript no consent can be given, so nothing may be requested.
 *
 * This plugin only decides WHICH container id the output uses:
 *
 *   SITE_GTM_CONTAINER_ID unset  → production builds keep the default container (DEFAULT_GTM_CONTAINER_ID);
 *                                  `vite dev` strips the snippet so local development never pollutes analytics
 *   SITE_GTM_CONTAINER_ID=GTM-…  → that container (also enables GTM in `vite dev`)
 *   SITE_GTM_CONTAINER_ID=""     → no Tag Manager at all (snippet removed, no consent bar)
 *
 * The resolved id is also exposed to the app as `__SITE_GTM_ID__` (vite.config.ts) so the consent
 * bar and the dataLayer page-view events follow the same switch. Container ids are public values.
 */
export const DEFAULT_GTM_CONTAINER_ID = 'GTM-T2SXFX3Q'

const ID_PATTERN = /^GTM-[A-Z0-9]{4,12}$/

export function resolveGtmContainerId(env: Record<string, string | undefined>, command: 'build' | 'serve'): string {
  const raw = env.SITE_GTM_CONTAINER_ID
  if (raw === undefined) return command === 'build' ? DEFAULT_GTM_CONTAINER_ID : ''
  const id = raw.trim()
  if (id === '') return ''
  if (!ID_PATTERN.test(id)) throw new Error(`SITE_GTM_CONTAINER_ID must look like GTM-XXXXXXX (got "${raw}")`)
  return id
}

const BLOCKS = [/<!--gtm:head-->[\s\S]*?<!--\/gtm:head-->\s*/]

export function tagManager(containerId: string): Plugin {
  return {
    name: 'tmistan:tag-manager',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        for (const block of BLOCKS) if (!block.test(html)) throw new Error('index.html lacks the Google Tag Manager marker block')
        if (containerId === '') return BLOCKS.reduce((out, block) => out.replace(block, ''), html)
        const out = html.split(DEFAULT_GTM_CONTAINER_ID).join(containerId)
        if ((out.match(/googletagmanager\.com\/gtm\.js\?id=/g) ?? []).length !== 1) throw new Error('index.html must contain exactly one Google Tag Manager script')
        return out
      },
    },
  }
}
