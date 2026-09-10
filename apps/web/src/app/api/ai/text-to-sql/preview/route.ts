import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

import { API_URL, AUTH_COOKIE, forwardJson } from '../../../_lib/proxy'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const token = cookies().get(AUTH_COOKIE)?.value
  if (!token) {
    return NextResponse.json({ message: 'Authentication required' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: 'A JSON question is required' }, { status: 400 })
  }

  return forwardJson(`${API_URL}/ai/text-to-sql/preview`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}
