import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000'
const AUTH_COOKIE = 'auth-token'

export async function POST(): Promise<NextResponse> {
  const token = cookies().get(AUTH_COOKIE)?.value

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

  cookies().delete(AUTH_COOKIE)
  return new NextResponse(null, { status: 204 })
}
