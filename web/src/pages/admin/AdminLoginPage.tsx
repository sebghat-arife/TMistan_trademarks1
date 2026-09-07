import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { KeyRound, LogIn } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { isLocalStack } from '@/lib/supabase'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { Logo } from '@/components/Logo'

export function AdminLoginPage() {
  const { t } = useTranslation()
  const auth = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useDocumentTitle(`${t('admin.loginTitle')} · ${t('app.shortName')}`)

  if (auth.isAdmin) return <Navigate to="/admin" replace />

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    if (isLocalStack) {
      if (token.trim()) auth.signInWithToken(token)
      return
    }
    setBusy(true)
    const message = await auth.signIn(email, password)
    setBusy(false)
    if (message) setErr(message)
  }

  return (
    <div className="container-x flex justify-center py-16">
      <form onSubmit={submit} className="card w-full max-w-md p-8">
        <Logo className="mx-auto h-12" />
        <h1 className="mt-6 text-center text-[22px] font-bold text-ink-900">{t('admin.loginTitle')}</h1>
        <p className="muted mt-1 text-center">{t('admin.loginHint')}</p>

        {isLocalStack ? (
          <>
            <p className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">{t('admin.notConfigured')}</p>
            <label className="mt-4 block text-[13px] font-medium text-ink-700">
              LOCAL_ADMIN_KEY
              <textarea value={token} onChange={(e) => setToken(e.target.value)} rows={3} className="field mt-1 h-auto py-2 font-mono text-[12px]" placeholder="eyJhbGciOi…" dir="ltr" />
            </label>
          </>
        ) : (
          <>
            <label className="mt-6 block text-[13px] font-medium text-ink-700">
              {t('admin.email')}
              <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="field mt-1" dir="ltr" />
            </label>
            <label className="mt-3 block text-[13px] font-medium text-ink-700">
              {t('admin.password')}
              <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="field mt-1" dir="ltr" />
            </label>
          </>
        )}

        {err && <p className="mt-3 text-[13px] text-red-700" role="alert">{err}</p>}
        {auth.isAdmin === false && (auth.session || !isLocalStack ? null : null)}
        {auth.session && auth.isAdmin === false && <p className="mt-3 text-[13px] text-red-700" role="alert">{t('admin.noAccess')}</p>}

        <button type="submit" disabled={busy} className="btn-primary mt-6 w-full">
          {isLocalStack ? <KeyRound className="h-4 w-4" /> : <LogIn className="h-4 w-4" />} {t('admin.signIn')}
        </button>
      </form>
    </div>
  )
}
