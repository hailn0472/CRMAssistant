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

async function verifyJwt(token: string): Promise<boolean> {
  try {
    const secret = process.env['JWT_SECRET']
    if (!secret || secret.length < 32) return false

    const parts = token.split('.')
    if (parts.length !== 3) return false

    const [encodedHeader, encodedPayload, encodedSignature] = parts

    // Use Node's crypto.createHmac (dynamic import so Next.js doesn't
    // tree-shake it in middleware builds). Web Crypto crypto.subtle with
    // HMAC is rejected by some Node runtimes (e.g. GitHub Actions).
    const { createHmac } = await import('crypto')
    const expectedSignature = createHmac('sha256', secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url')

    if (encodedSignature !== expectedSignature) return false

    const claims = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf-8'),
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
