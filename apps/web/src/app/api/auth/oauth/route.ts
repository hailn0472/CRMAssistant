import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000'
const AUTH_COOKIE = 'auth-token'
const ONE_DAY_SECONDS = 86_400

export async function POST(request: Request): Promise<NextResponse> {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 })
  }
  const accessToken = typeof body['accessToken'] === 'string' ? body['accessToken'] : ''
  if (!accessToken) {
    return NextResponse.json({ message: 'Missing access token' }, { status: 400 })
  }

  // Forward access_token to NestJS backend
  const response = await fetch(`${API_URL}/auth/oauth-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken }),
  })

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>

  if (!response.ok) {
    return NextResponse.json(data, { status: response.status })
  }

  const jwtToken = data['accessToken']
  if (typeof jwtToken !== 'string') {
    return NextResponse.json({ message: 'Invalid auth response' }, { status: 502 })
  }

  cookies().set(AUTH_COOKIE, jwtToken, {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ONE_DAY_SECONDS,
  })

  return NextResponse.json(data)
}
