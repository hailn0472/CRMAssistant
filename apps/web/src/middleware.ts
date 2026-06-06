import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const AUTH_COOKIE = 'auth-token'
const PUBLIC_PATHS = ['/login', '/register', '/forgot-password']

type JwtClaims = {
  userId?: unknown
  tenantId?: unknown
  role?: unknown
  exp?: unknown
}

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname)
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

async function verifyJwt(token: string): Promise<boolean> {
  try {
    const secret = process.env['JWT_SECRET']
    if (!secret || secret.length < 32) return false

    const parts = token.split('.')
    if (parts.length !== 3) return false

    const [encodedHeader, encodedPayload, encodedSignature] = parts
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    )

    const isSignatureValid = await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlToBytes(encodedSignature).buffer as ArrayBuffer,
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`).buffer as ArrayBuffer,
    )

    if (!isSignatureValid) return false

    const claims = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(encodedPayload)),
    ) as JwtClaims
    const nowSeconds = Math.floor(Date.now() / 1000)
    return (
      typeof claims.userId === 'string' &&
      typeof claims.tenantId === 'string' &&
      typeof claims.role === 'string' &&
      typeof claims.exp === 'number' &&
      claims.exp > nowSeconds
    )
  } catch {
    return false
  }
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const token = request.cookies.get(AUTH_COOKIE)?.value
  const { pathname, search } = request.nextUrl
  const isPublicRoute = isPublicPath(pathname)
  const isAuthenticated = token ? await verifyJwt(token) : false

  if (!isAuthenticated && !isPublicRoute) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', `${pathname}${search}`)
    const response = NextResponse.redirect(loginUrl)
    if (token) {
      response.cookies.delete(AUTH_COOKIE)
    }
    return response
  }

  if (isAuthenticated && (isPublicRoute || pathname === '/')) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  const response = NextResponse.next()
  if (token && !isAuthenticated) {
    response.cookies.delete(AUTH_COOKIE)
  }
  return response
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
