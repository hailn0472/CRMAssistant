import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

import { API_URL, AUTH_COOKIE, forwardJson } from '../../../_lib/proxy'

export async function GET(
  _request: Request,
  { params }: { params: { importId: string } },
): Promise<NextResponse> {
  const realToken = cookies().get(AUTH_COOKIE)?.value
  if (!realToken) {
    return NextResponse.json({ message: 'Authentication required' }, { status: 401 })
  }

  return forwardJson(
    `${API_URL}/api/contacts/import/${encodeURIComponent(params.importId)}/status`,
    {
      headers: { Authorization: `Bearer ${realToken}` },
      timeoutMs: 15_000,
    },
  )
}
