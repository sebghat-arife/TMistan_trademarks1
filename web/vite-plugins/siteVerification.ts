import type { Plugin } from 'vite'

/**
 * Search-engine ownership verification (Google Search Console, Bing Webmaster Tools).
 *
 * When the build environment provides a verification token, the matching <meta> tag is
 * injected into index.html — and therefore into every prerendered page and the SPA shell,
 * which are all derived from that template. Nothing is emitted when the variables are unset,
 * so the output is byte-identical for environments that do not need verification.
 *
 *   SITE_GOOGLE_SITE_VERIFICATION  → <meta name="google-site-verification" content="…">
 *   SITE_BING_SITE_VERIFICATION    → <meta name="msvalidate.01" content="…">
 *
 * Tokens are public by design (they appear in the page source of every verified site) and are
 * not secrets; they only prove control of the domain to the respective console.
 */
export function siteVerification(env: Record<string, string | undefined>): Plugin {
  const tags: { name: string; content: string }[] = []
  const add = (name: string, raw: string | undefined) => {
    const content = (raw ?? '').trim()
    if (!content) return
    if (!/^[A-Za-z0-9_=-]{8,128}$/.test(content)) throw new Error(`Invalid verification token for ${name}: expected the raw "content" value of the meta tag, not the whole tag`)
    tags.push({ name, content })
  }
  add('google-site-verification', env.SITE_GOOGLE_SITE_VERIFICATION)
  add('msvalidate.01', env.SITE_BING_SITE_VERIFICATION)
  return {
    name: 'tmistan:site-verification',
    transformIndexHtml: {
      order: 'post',
      handler: () => tags.map(({ name, content }) => ({ tag: 'meta', attrs: { name, content }, injectTo: 'head' as const })),
    },
  }
}
