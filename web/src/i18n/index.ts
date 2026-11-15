import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import { isSiteLocale, siteLocale, type SiteLocaleCode } from '@/seo/locales'

export const LANGUAGES = [
  { code: 'en', label: 'English', short: 'EN', dir: 'ltr' },
  { code: 'fa', label: 'دری', short: 'DR', dir: 'rtl' },
  { code: 'ps', label: 'پښتو', short: 'PS', dir: 'rtl' },
] as const

export type LanguageCode = (typeof LANGUAGES)[number]['code']

/**
 * The language is part of the URL (/fa/…, /ps/…, English without prefix — see
 * seo/locales.ts). The stored preference uses the key the former browser
 * language detector wrote, so returning visitors keep their choice.
 */
export const LANGUAGE_STORAGE_KEY = 'i18nextLng'

/* Only English ships in the main bundle; Dari and Pashto are loaded on demand
 * for the language in the URL (≈200 kB of JSON each that English visitors
 * never needed). The prerenderer loads whichever language it is rendering. */
const LOCALE_LOADERS: Record<Exclude<SiteLocaleCode, 'en'>, () => Promise<{ default: Record<string, unknown> }>> = {
  fa: () => import('./locales/fa.json'),
  ps: () => import('./locales/ps.json'),
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: 'en',
  fallbackLng: 'en',
  supportedLngs: LANGUAGES.map((l) => l.code),
  partialBundledLanguages: true,
  interpolation: { escapeValue: false },
  initAsync: false,
})

/** Make sure a language's resources are loaded, then activate it. */
export async function loadLanguage(lng: SiteLocaleCode): Promise<void> {
  if (lng !== 'en' && !i18n.hasResourceBundle(lng, 'translation')) {
    const mod = await LOCALE_LOADERS[lng]()
    i18n.addResourceBundle(lng, 'translation', mod.default, true, true)
  }
  if (i18n.resolvedLanguage !== lng) await i18n.changeLanguage(lng)
}

export function applyDocumentDirection(lng: string) {
  if (typeof document === 'undefined') return
  const locale = siteLocale(lng)
  document.documentElement.lang = locale.htmlLang
  document.documentElement.dir = locale.dir
}

if (typeof document !== 'undefined') i18n.on('languageChanged', applyDocumentDirection)

export function storedLanguage(): SiteLocaleCode | null {
  try {
    const v = localStorage.getItem(LANGUAGE_STORAGE_KEY)
    return isSiteLocale(v) ? v : null
  } catch {
    return null
  }
}

export function rememberLanguage(lng: SiteLocaleCode) {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lng)
  } catch {
    /* storage unavailable (private mode) — the URL still carries the language */
  }
}

export default i18n
