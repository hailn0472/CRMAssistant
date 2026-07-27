import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

import { API_URL, AUTH_COOKIE } from '../_lib/proxy'

const EXPORT_TIMEOUT_MS = 120_000

export async function GET(request: NextRequest): Promise<NextResponse | Response> {
  const realToken = cookies().get(AUTH_COOKIE)?.value
  if (!realToken) {
    return NextResponse.json({ message: 'Authentication required' }, { status: 401 })
  }

  const searchParams = request.nextUrl.searchParams.toString()
  const url = `${API_URL}/api/contacts/export${searchParams ? `?${searchParams}` : ''}`

  let response: Response
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${realToken}` },
      signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS),
    })
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError'
    return NextResponse.json(
      { message: timedOut ? 'The export took too long to generate' : 'Backend request failed' },
      { status: timedOut ? 504 : 502 },
    )
  }

  if (!response.ok) {
    const text = await response.text()
    let payload: unknown
    try {
      payload = text ? JSON.parse(text) : { message: 'Export failed' }
    } catch {
      payload = { message: text.trim() || 'Export failed' }
    }
    return NextResponse.json(payload, { status: response.status })
  }

  // Pipe the upstream body straight through instead of buffering the whole CSV
  // in this process, and keep the API's own charset and filename so accented
  // names survive and the download stays date-stamped.
  return new Response(response.body, {
    status: 200,
    headers: {
      'Content-Type': response.headers.get('content-type') ?? 'text/csv; charset=utf-8',
      'Content-Disposition':
        response.headers.get('content-disposition') ?? 'attachment; filename="contacts-export.csv"',
    },
  })
}
