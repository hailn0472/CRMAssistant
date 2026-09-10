'use client'

import { useSearchParams } from 'next/navigation'
import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import toast from 'react-hot-toast'

import { connectCalendar } from '@/services/calendar.service'
import type { CalendarProvider } from '@/services/calendar.service'

// The only place the OAuth redirect lands (AC 41) — no new NestJS REST
// controller. Reads ?code/?state/?error, calls connectCalendar, redirects
// back to /settings/calendars with a toast. The user-denied case
// (?error=access_denied) is a normal, non-scary message, not an error
// boundary.

const CALENDAR_CONNECT_PROVIDER_KEY = 'calendar-connect-provider'

function readStoredProvider(): CalendarProvider | null {
  const raw = sessionStorage.getItem(CALENDAR_CONNECT_PROVIDER_KEY)
  if (raw === 'GOOGLE' || raw === 'OUTLOOK') return raw
  return null
}

export default function CalendarCallbackPage(): React.JSX.Element {
  const router = useRouter()
  const searchParams = useSearchParams()
  const handledRef = useRef(false)

  useEffect(() => {
    if (handledRef.current) return
    handledRef.current = true

    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    // User denied the consent screen — calm, normal copy (AC 41).
    if (error === 'access_denied') {
      sessionStorage.removeItem(CALENDAR_CONNECT_PROVIDER_KEY)
      toast('Calendar connection cancelled — nothing was changed')
      router.replace('/settings/calendars')
      return
    }

    if (error) {
      sessionStorage.removeItem(CALENDAR_CONNECT_PROVIDER_KEY)
      toast.error('Calendar connection failed — please try again')
      router.replace('/settings/calendars')
      return
    }

    if (!code || !state) {
      sessionStorage.removeItem(CALENDAR_CONNECT_PROVIDER_KEY)
      toast.error('Calendar connection could not be completed — please try again')
      router.replace('/settings/calendars')
      return
    }

    const provider = readStoredProvider()
    if (!provider) {
      sessionStorage.removeItem(CALENDAR_CONNECT_PROVIDER_KEY)
      toast.error('Calendar connection expired — please start again from Settings')
      router.replace('/settings/calendars')
      return
    }

    connectCalendar({ provider, authCode: code, state })
      .then(() => {
        sessionStorage.removeItem(CALENDAR_CONNECT_PROVIDER_KEY)
        // Success copy states impact (UX Feedback Patterns).
        toast.success(
          provider === 'GOOGLE'
            ? 'Google Calendar connected — tasks will now sync to it'
            : 'Outlook Calendar connected — tasks will now sync to it',
        )
        router.replace('/settings/calendars')
      })
      .catch((err: unknown) => {
        sessionStorage.removeItem(CALENDAR_CONNECT_PROVIDER_KEY)
        toast.error(
          err instanceof Error && err.message
            ? err.message
            : 'Calendar connection failed — please try again',
        )
        router.replace('/settings/calendars')
      })
  }, [router, searchParams])

  // Brief "Connecting…" state — the redirect happens in the effect above.
  return (
    <main className="space-y-6 p-6 text-slate-950">
      <h1 className="text-xl font-semibold tracking-tight">Connecting…</h1>
      <p className="text-sm text-slate-600">Completing your calendar connection…</p>
    </main>
  )
}
