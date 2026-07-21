import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

const AUTH_COOKIE = 'auth-token'
const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000'

/**
 * Mints a short-lived, single-use WebSocket handshake token via the backend
 * (`GET /auth/ws-token`) instead of ever returning the real httpOnly
 * `auth-token` cookie value to client-side JS.
 *
 * Client code (e.g. the GraphQL subscription WebSocket client) needs
 * something to send explicitly in the `connection_init` payload after a page
 * reload, since it cannot rely on the browser attaching the httpOnly cookie
 * the way normal `fetch`/XHR requests do. Previously this route returned the
 * real JWT, which meant any same-origin JS (including an XSS payload) could
 * read the full, long-lived session token via a single `fetch` call — the
 * same token used to authenticate every other request. That defeated the
 * point of httpOnly.
 *
 * Now: the real token never leaves this server. It's forwarded
 * server-to-server (like `/api/graphql`) to mint an opaque token that
 * expires in seconds and can be used exactly once — even if leaked, it's
 * useless a moment later and can't be replayed to open a second connection
 * or used to call any other authenticated endpoint.
 */
export async function GET(): Promise<NextResponse> {
  const realToken = cookies().get(AUTH_COOKIE)?.value
  if (!realToken) {
    return NextResponse.json({ wsToken: null })
  }

  try {
    const response = await fetch(`${API_URL}/auth/ws-token`, {
      headers: { Authorization: `Bearer ${realToken}` },
    })
    if (!response.ok) {
      return NextResponse.json({ wsToken: null })
    }
    const data = (await response.json()) as { wsToken: string }
    return NextResponse.json({ wsToken: data.wsToken })
  } catch {
    return NextResponse.json({ wsToken: null })
  }
}
