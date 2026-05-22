import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

import {
  BACKEND_AUTH_COOKIE,
  ONE_DAY_SECONDS,
  WEB_SESSION_COOKIE,
  createWebSessionCookieValue,
} from '@/lib/auth-cookies'

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000'

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as unknown
  const response = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>

  if (!response.ok) {
    return NextResponse.json(data, { status: response.status })
  }

  const accessToken = data['accessToken']
  if (typeof accessToken !== 'string') {
    return NextResponse.json({ message: 'Invalid auth response' }, { status: 502 })
  }

  const cookieStore = cookies()
  const expiresAtSeconds = Math.floor(Date.now() / 1000) + ONE_DAY_SECONDS
  const webSession = await createWebSessionCookieValue(expiresAtSeconds)

  cookieStore.set(BACKEND_AUTH_COOKIE, accessToken, {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ONE_DAY_SECONDS,
  })
  cookieStore.set(WEB_SESSION_COOKIE, webSession, {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ONE_DAY_SECONDS,
  })

  return NextResponse.json(data)
}
