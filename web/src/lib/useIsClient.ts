import { useSyncExternalStore } from 'react'

const noopSubscribe = () => () => {}

/**
 * `false` while rendering on the server and during hydration of prerendered
 * HTML, `true` afterwards. Use it for UI that depends on browser-only state
 * (storage, consent, media queries) so the first client render matches the
 * prerendered markup instead of producing a hydration mismatch.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false)
}

/** Read a browser-only boolean (e.g. from sessionStorage) in a hydration-safe way: `false` on the server/hydration pass. */
export function useClientFlag(read: () => boolean): boolean {
  return useSyncExternalStore(noopSubscribe, read, () => false)
}
