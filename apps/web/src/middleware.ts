import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import {
  BACKEND_AUTH_COOKIE,
  WEB_SESSION_COOKIE,
  verifyWebSessionCookieValue,
} from '@/lib/auth-cookies'

const PUBLIC_PATHS = ['/login', '/register', '/forgot-password']

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const session = request.cookies.get(WEB_SESSION_COOKIE)?.value
  const { pathname, search } = request.nextUrl
  const isPublicPath = PUBLIC_PATHS.some((path) => pathname.startsWith(path))
  const isAuthenticated = session ? await verifyWebSessionCookieValue(session) : false

  if (!isAuthenticated && !isPublicPath) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', `${pathname}${search}`)
    const response = NextResponse.redirect(loginUrl)
    if (session) {
      response.cookies.delete(WEB_SESSION_COOKIE)
      response.cookies.delete(BACKEND_AUTH_COOKIE)
    }
    return response
  }

  if (isAuthenticated && isPublicPath) {
    return NextResponse.redirect(new URL('/contacts', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
}
