import { useTranslation } from 'react-i18next'
import { AlertTriangle, Database, Inbox, RefreshCw } from 'lucide-react'
import { DataError } from '@/services'
import { cn } from '@/lib/utils'

/* Shared loading / empty / error presentation for every data-driven block.
 * Never renders placeholder data — if the database has nothing, it says so. */

export function LoadingState({ className, lines = 3 }: { className?: string; lines?: number }) {
  const { t } = useTranslation()
  return (
    <div className={cn('card animate-pulse space-y-3 p-5', className)} role="status" aria-live="polite" aria-label={t('common.loading')}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-3 rounded bg-ink-100" style={{ width: `${90 - i * 18}%` }} />
      ))}
      <span className="sr-only">{t('common.loading')}</span>
    </div>
  )
}

export function EmptyState({ title, hint, className }: { title: string; hint?: string; className?: string }) {
  return (
    <div className={cn('card flex flex-col items-center p-10 text-center', className)}>
      <span className="icon-circle h-12 w-12"><Inbox className="h-5 w-5" /></span>
      <p className="mt-3 text-[15px] font-medium text-ink-900">{title}</p>
      {hint && <p className="muted mt-1 max-w-md">{hint}</p>}
    </div>
  )
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const { t } = useTranslation()
  const err = error instanceof Error ? error : new Error(String(error))
  const schema = err instanceof DataError && err.code === 'schema_missing'
  return (
    <div className={cn('card flex flex-col items-start gap-3 border-red-200 bg-red-50/40 p-5 sm:flex-row sm:items-center', className)} role="alert">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-700">
        {schema ? <Database className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium text-ink-900">{schema ? t('common.schemaMissing') : t('common.error')}</p>
        <p className="mt-0.5 break-words text-[13px] text-ink-600" dir="ltr">{err.message}</p>
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-secondary h-9 px-3 text-[13px]">
          <RefreshCw className="h-4 w-4" /> {t('common.retry')}
        </button>
      )}
    </div>
  )
}
