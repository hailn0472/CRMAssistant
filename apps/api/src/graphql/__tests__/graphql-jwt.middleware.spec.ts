import { UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'

import { GraphqlJwtMiddleware } from '../graphql-jwt.middleware'

import type { NextFunction, Request, Response } from 'express'
import type { JwtPayload } from '../../auth/strategies/jwt.strategy'

type GraphqlRequest = Request & { user?: JwtPayload }

const JWT_SECRET = 'graphql-middleware-secret-min-32-chars'

function createMiddleware(): GraphqlJwtMiddleware {
  return new GraphqlJwtMiddleware({
    get: jest.fn((key: string): string | undefined =>
      key === 'JWT_SECRET' ? JWT_SECRET : undefined,
    ),
  } as unknown as ConfigService)
}

function createRequest(authorization?: string): GraphqlRequest {
  return {
    headers: authorization ? { authorization } : {},
  } as GraphqlRequest
}

describe('GraphqlJwtMiddleware', () => {
  it('continues without user when authorization header is missing', () => {
    const middleware = createMiddleware()
    const request = createRequest()
    const next = jest.fn() as NextFunction

    middleware.use(request, {} as Response, next)

    expect(request.user).toBeUndefined()
    expect(next).toHaveBeenCalledWith()
  })

  it('continues without user when authorization header is not bearer token', () => {
    const middleware = createMiddleware()
    const request = createRequest('Basic token')
    const next = jest.fn() as NextFunction

    middleware.use(request, {} as Response, next)

    expect(request.user).toBeUndefined()
    expect(next).toHaveBeenCalledWith()
  })

  it('attaches verified JWT payload to the request', () => {
    const middleware = createMiddleware()
    const token = new JwtService({ secret: JWT_SECRET }).sign({
      sub: 'user-1',
      email: 'ada@example.com',
      tenantId: 'tenant-1',
    })
    const request = createRequest(`Bearer ${token}`)
    const next = jest.fn() as NextFunction

    middleware.use(request, {} as Response, next)

    expect(request.user).toMatchObject({
      sub: 'user-1',
      email: 'ada@example.com',
      tenantId: 'tenant-1',
    })
    expect(next).toHaveBeenCalledWith()
  })

  it('passes UnauthorizedException to next when JWT is invalid', () => {
    const middleware = createMiddleware()
    const request = createRequest('Bearer invalid-token')
    const next = jest.fn() as NextFunction

    middleware.use(request, {} as Response, next)

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedException))
  })
})
