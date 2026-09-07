import { useCallback, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { LOCAL_ADMIN_TOKEN_KEY, isLocalStack, localAdminToken, supabase } from './supabase'

export interface AuthState {
  /** Undefined while the initial session is being resolved. */
  session: Session | null | undefined
  /** Result of the RLS-side `is_admin()` check for the current token. */
  isAdmin: boolean | undefined
  loading: boolean
  signIn: (email: string, password: string) => Promise<string | null>
  /** Local stack only: accept a pre-minted `authenticated` JWT (see keys.env). */
  signInWithToken: (token: string) => void
  signOut: () => Promise<void>
}

/**
 * Thin wrapper over Supabase Auth. Authorisation is *never* decided in the
 * browser: the dashboard only renders data RLS lets the token read, and the
 * `is_admin()` RPC is what unlocks the admin routes.
 */
export function useAuth(): AuthState {
  const qc = useQueryClient()
  const [session, setSession] = useState<Session | null | undefined>(isLocalStack ? null : undefined)

  useEffect(() => {
    if (isLocalStack) return
    let alive = true
    void supabase.auth.getSession().then(({ data }) => {
      if (alive) setSession(data.session)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession(s)
      void qc.invalidateQueries()
    })
    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [qc])

  const hasToken = isLocalStack ? !!localAdminToken : !!session
  const { data: isAdmin, isLoading } = useQuery({
    queryKey: ['is_admin', isLocalStack ? localAdminToken : session?.access_token],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('is_admin')
      if (error) throw new Error(error.message)
      return data === true
    },
    enabled: hasToken,
    staleTime: 60_000,
  })

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return error ? error.message : null
  }, [])

  const signInWithToken = useCallback((token: string) => {
    sessionStorage.setItem(LOCAL_ADMIN_TOKEN_KEY, token.trim())
    window.location.assign('/admin') // re-create the client with the bearer header
  }, [])

  const signOut = useCallback(async () => {
    if (isLocalStack) {
      sessionStorage.removeItem(LOCAL_ADMIN_TOKEN_KEY)
      window.location.assign('/')
      return
    }
    await supabase.auth.signOut()
    qc.clear()
  }, [qc])

  return {
    session,
    isAdmin: hasToken ? isAdmin : false,
    loading: session === undefined || (hasToken && isLoading),
    signIn,
    signInWithToken,
    signOut,
  }
}
