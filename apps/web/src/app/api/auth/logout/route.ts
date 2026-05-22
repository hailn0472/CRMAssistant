import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

import { BACKEND_AUTH_COOKIE, WEB_SESSION_COOKIE } from '@/lib/auth-cookies'

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000'

export async function POST(): Promise<NextResponse> {
  const cookieStore = cookies()
  const token = cookieStore.get(BACKEND_AUTH_COOKIE)?.value

  if (token) {
    await fetch(`${API_URL}/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    }).catch(() => {
      // local cookie cleanup should still happen if backend is unavailable
    })
  }

  cookieStore.delete(BACKEND_AUTH_COOKIE)
  cookieStore.delete(WEB_SESSION_COOKIE)
  return new NextResponse(null, { status: 204 })
}
