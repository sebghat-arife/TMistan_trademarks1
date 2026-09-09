/**
 * TMistan data access layer.
 *
 * UI code imports from '@/services' only; nothing else in the app talks to
 * Supabase directly. Every function runs against the live database with the
 * publishable key under Row Level Security — there is no mock or fallback data.
 */
export * from './_shared'
export * from './trademark_service'
export * from './gazette_service'
export * from './image_service'
export * from './stats_service'
export * from './admin_service'
