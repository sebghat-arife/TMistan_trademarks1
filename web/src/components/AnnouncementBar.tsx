import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Megaphone, X } from 'lucide-react'
import { useClientFlag } from '@/lib/useIsClient'

/**
 * Slim site-wide announcement strip rendered above the header (see Layout).
 *
 * - The message moves as a CSS animation only (styles: `.announce-*` in
 *   index.css): the track holds COPIES identical copies and translates by
 *   exactly one copy per loop, so the repetition is seamless; no timers run.
 * - The copy width is measured once (and on resize) so the speed in px/s is
 *   the same for every language and viewport; the speed itself is a CSS
 *   variable per breakpoint.
 * - Hover / keyboard focus pauses the movement; `prefers-reduced-motion`
 *   shows the message statically (CSS).
 * - Screen readers get ONE static copy; the moving copies are aria-hidden,
 *   so nothing is announced repeatedly.
 * - Dismissal is remembered for the browser session only.
 */

/** Bump the suffix when the wording changes so visitors who dismissed an older message see the new one. */
const DISMISS_KEY = 'tmistan.announcement.dismissed.v1'
/** Copies in the moving track — enough that very wide screens never show an empty stretch. */
const COPIES = 4

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

export function AnnouncementBar() {
  const { t, i18n } = useTranslation()
  // Hydration-safe: the prerendered HTML always contains the bar; a dismissal stored for this
  // session hides it on the first client render, a click hides it immediately.
  const dismissedBefore = useClientFlag(readDismissed)
  const [dismissedNow, setDismissed] = useState(false)
  const dismissed = dismissedBefore || dismissedNow
  const trackRef = useRef<HTMLDivElement>(null)

  // Keep the speed constant: duration = copy width / speed (computed in CSS from this variable).
  useEffect(() => {
    const track = trackRef.current
    const first = track?.firstElementChild
    if (!track || !first || typeof ResizeObserver === 'undefined') return
    const apply = () => track.style.setProperty('--announce-copy-width', String(Math.round(first.getBoundingClientRect().width) || 0))
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(first)
    return () => ro.disconnect()
  }, [dismissed, i18n.resolvedLanguage])

  if (dismissed) return null

  const message = t('announcement.message')
  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* storage unavailable (private mode) — dismiss for this page view only */
    }
    setDismissed(true)
  }

  return (
    <div className="announce" role="region" aria-label={t('announcement.label')} data-testid="announcement-bar">
      <div className="container-x announce-inner">
        <span className="announce-icon" aria-hidden="true">
          <Megaphone />
        </span>
        {/* The one copy assistive technology reads; the moving copies below are decorative. */}
        <p className="sr-only">{message}</p>
        <div className="announce-viewport">
          <div ref={trackRef} className="announce-track" aria-hidden="true">
            {Array.from({ length: COPIES }, (_, i) => (
              <span key={i} className="announce-item">
                {message}
              </span>
            ))}
          </div>
        </div>
        <button type="button" className="announce-close" onClick={dismiss} aria-label={t('announcement.dismiss')} data-testid="announcement-dismiss">
          <X />
        </button>
      </div>
    </div>
  )
}
