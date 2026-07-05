import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const AUTH_COOKIE = 'auth-token'
const PUBLIC_PATHS = ['/login', '/register', '/forgot-password']

type JwtClaims = {
  userId?: unknown
  tenantId?: unknown
  roles?: unknown
  exp?: unknown
}

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname)
}

function base64UrlToBytes(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

async function verifyJwt(token: string): Promise<boolean> {
  try {
    const secret = process.env['JWT_SECRET']
    if (!secret || secret.length < 32) return false

    const parts = token.split('.')
    if (parts.length !== 3) return false

    const [encodedHeader, encodedPayload, encodedSignature] = parts

    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    )

    const signatureBytes = base64UrlToBytes(encodedSignature)
    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      new Uint8Array(signatureBytes),
      encoder.encode(`${encodedHeader}.${encodedPayload}`),
    )

    if (!isValid) return false

    const json = atob(encodedPayload.replace(/-/g, '+').replace(/_/g, '/'))
    const claims = JSON.parse(json) as JwtClaims
    const nowSeconds = Math.floor(Date.now() / 1000)
    return (
      typeof claims.userId === 'string' &&
      typeof claims.tenantId === 'string' &&
      Array.isArray(claims.roles) &&
      typeof claims.exp === 'number' &&
      claims.exp > nowSeconds
    )
  } catch (err) {
    console.error('[middleware] verifyJwt error:', err)
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
