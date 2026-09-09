import { Logo } from './Logo'

/** Shown instead of the app when the build has no Supabase settings. Never falls back to sample data. */
export function ConfigScreen({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 p-6">
      <div className="card max-w-lg p-8">
        <Logo className="h-11" />
        <h1 className="mt-6 text-[20px] font-bold text-ink-900">TMistan is not configured</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-700">{message}</p>
        <pre className="mt-4 overflow-x-auto rounded-md bg-ink-900 p-4 text-[12px] leading-relaxed text-white" dir="ltr">{`SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_…   # public key only`}</pre>
        <p className="muted mt-3">Set these in the deployment environment (Railway / Render / .env) and rebuild. The service-role key is never used by the web app.</p>
      </div>
    </div>
  )
}
