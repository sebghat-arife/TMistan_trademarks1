import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import fa from './locales/fa.json'
import ps from './locales/ps.json'

export const LANGUAGES = [
  { code: 'en', label: 'English', short: 'EN', dir: 'ltr' },
  { code: 'fa', label: 'دری', short: 'DR', dir: 'rtl' },
  { code: 'ps', label: 'پښتو', short: 'PS', dir: 'rtl' },
] as const

export type LanguageCode = (typeof LANGUAGES)[number]['code']

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, fa: { translation: fa }, ps: { translation: ps } },
    fallbackLng: 'en',
    supportedLngs: LANGUAGES.map((l) => l.code),
    interpolation: { escapeValue: false },
    detection: { order: ['querystring', 'localStorage', 'navigator'], lookupQuerystring: 'lang', caches: ['localStorage'] },
  })

export function applyDocumentDirection(lng: string) {
  const lang = LANGUAGES.find((l) => l.code === lng) ?? LANGUAGES[0]
  document.documentElement.lang = lang.code
  document.documentElement.dir = lang.dir
}

applyDocumentDirection(i18n.resolvedLanguage ?? 'en')
i18n.on('languageChanged', applyDocumentDirection)

export default i18n
