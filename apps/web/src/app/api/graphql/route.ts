import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000'
const AUTH_COOKIE = 'auth-token'

export async function POST(request: Request): Promise<NextResponse> {
  const token = cookies().get(AUTH_COOKIE)?.value
  let body: unknown

  try {
    body = (await request.json()) as unknown
  } catch {
    return NextResponse.json(
      { errors: [{ message: 'Invalid JSON request body' }] },
      { status: 400 },
    )
  }

  const response = await fetch(`${API_URL}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })

  const data = (await response.json().catch(() => ({}))) as unknown
  return NextResponse.json(data, { status: response.status })
}
