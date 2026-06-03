import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000'
const AUTH_COOKIE = 'auth-token'
const ONE_DAY_SECONDS = 86_400

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as unknown
  const response = await fetch(`${API_URL}/auth/register`, {
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

  cookies().set(AUTH_COOKIE, accessToken, {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ONE_DAY_SECONDS,
  })

  return NextResponse.json(data)
}
