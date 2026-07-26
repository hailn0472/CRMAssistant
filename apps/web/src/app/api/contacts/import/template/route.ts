import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000'
const AUTH_COOKIE = 'auth-token'

export async function GET(): Promise<NextResponse> {
  const realToken = cookies().get(AUTH_COOKIE)?.value
  if (!realToken) {
    return NextResponse.json({ message: 'Authentication required' }, { status: 401 })
  }

  try {
    const response = await fetch(`${API_URL}/api/contacts/import/template`, {
      headers: { Authorization: `Bearer ${realToken}` },
    })

    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch {
    return NextResponse.json({ message: 'Backend request failed' }, { status: 502 })
  }
}
