/** Public, non-secret site metadata injected at build time (see vite.config.ts). */
declare const __SITE_CONTACT__: { email: string; phone: string; address: string; facebook: string; twitter: string; linkedin: string }
declare const __APP_VERSION__: string

export const SITE_CONTACT = __SITE_CONTACT__
export const APP_VERSION = __APP_VERSION__
