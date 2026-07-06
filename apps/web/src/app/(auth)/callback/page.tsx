'use client'

import { Suspense, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Card } from '@/components/ui/card'

function OAuthCallback(): React.JSX.Element {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { oauthLogin } = useAuth()
  const calledRef = useRef(false)

  useEffect(() => {
    if (calledRef.current) return
    calledRef.current = true

    const redirect = searchParams.get('redirect')
    const SESSION_TIMEOUT_MS = 15_000

    // getSession() handles both PKCE code and implicit hash-fragment flows
    const sessionPromise = supabase.auth.getSession()
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('OAuth session retrieval timed out')), SESSION_TIMEOUT_MS),
    )

    Promise.race([sessionPromise, timeoutPromise])
      .then(({ data, error }) => {
        if (error || !data.session?.access_token) {
          router.replace('/login?error=oauth_failed')
          return
        }
        oauthLogin(data.session.access_token, redirect)?.catch(() => {
          router.replace('/login?error=oauth_failed')
        })
      })
      .catch(() => {
        router.replace('/login?error=oauth_failed')
      })
  }, [searchParams, router, oauthLogin])

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8">
      <Card className="w-full max-w-md border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-blue-700" />
          <p className="text-sm text-slate-600">Đang xác thực với Google...</p>
        </div>
      </Card>
    </main>
  )
}

export default function OAuthCallbackPage(): React.JSX.Element {
  return (
    <Suspense>
      <OAuthCallback />
    </Suspense>
  )
}
