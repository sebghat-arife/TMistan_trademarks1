import { useEffect } from 'react'

/**
 * Sets <title> (and optionally the description) for ADMIN pages only. Public
 * pages declare their metadata with <Seo> (src/seo/head.tsx), which also
 * manages canonical/hreflang/Open Graph/JSON-LD and works during prerendering.
 */
export function useDocumentTitle(title: string, description?: string) {
  useEffect(() => {
    const prev = document.title
    document.title = title
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]')
    const prevDesc = meta?.content
    if (description) {
      if (!meta) {
        meta = document.createElement('meta')
        meta.name = 'description'
        document.head.appendChild(meta)
      }
      meta.content = description
    }
    return () => {
      document.title = prev
      if (meta && prevDesc !== undefined) meta.content = prevDesc
    }
  }, [title, description])
}
