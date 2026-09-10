import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

import { API_URL, AUTH_COOKIE, forwardJson } from '../../_lib/proxy'

/** Uploads can be up to 10MB, so allow generous time before giving up. */
const UPLOAD_TIMEOUT_MS = 120_000

export async function POST(request: NextRequest): Promise<NextResponse> {
  const realToken = cookies().get(AUTH_COOKIE)?.value
  if (!realToken) {
    return NextResponse.json({ message: 'Authentication required' }, { status: 401 })
  }

  let formData: FormData
  try {
    // A malformed multipart body or a client that aborts mid-upload rejects
    // here; that is a bad request, not an unhandled server crash.
    formData = await request.formData()
  } catch {
    return NextResponse.json({ message: 'Invalid or incomplete upload' }, { status: 400 })
  }

  const searchParams = request.nextUrl.searchParams.toString()
  const url = `${API_URL}/api/contacts/import${searchParams ? `?${searchParams}` : ''}`

  return forwardJson(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${realToken}` },
    body: formData,
    timeoutMs: UPLOAD_TIMEOUT_MS,
  })
}
