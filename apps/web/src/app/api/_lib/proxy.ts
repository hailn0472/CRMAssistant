import { NextResponse } from 'next/server'

export const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000'
export const AUTH_COOKIE = 'auth-token'

const DEFAULT_TIMEOUT_MS = 30_000

type ForwardOptions = {
  method?: string
  headers?: Record<string, string>
  body?: BodyInit
  timeoutMs?: number
}

/**
 * Forwards a request to the NestJS API and relays its JSON response verbatim.
 *
 * The upstream status is always preserved: a 401, 413 or 400 must reach the
 * browser as itself so the UI can tell the user to re-login or shrink the file.
 * Only a genuine transport failure becomes a 502.
 */
export async function forwardJson(url: string, options: ForwardOptions): Promise<NextResponse> {
  const { method = 'GET', headers, body, timeoutMs = DEFAULT_TIMEOUT_MS } = options

  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError'
    return NextResponse.json(
      { message: timedOut ? 'The server took too long to respond' : 'Backend request failed' },
      { status: timedOut ? 504 : 502 },
    )
  }

  // Parse only after the transport succeeded, and never let a non-JSON body
  // (an HTML error page from a proxy, say) masquerade as a different status.
  const text = await response.text()
  let payload: unknown
  try {
    payload = text ? JSON.parse(text) : {}
  } catch {
    payload = {
      message: text.trim() || `Request failed with status ${response.status}`,
    }
  }

  return NextResponse.json(payload, { status: response.status })
}
