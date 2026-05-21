import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'

import type { NextFunction, Request, Response } from 'express'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

type GraphqlRequest = Request & { user?: JwtPayload }

function getBearerToken(request: Request): string | undefined {
  const authorization = request.headers.authorization
  if (!authorization?.startsWith('Bearer ')) {
    return undefined
  }
  return authorization.slice('Bearer '.length)
}

@Injectable()
export class GraphqlJwtMiddleware implements NestMiddleware {
  private readonly jwtService: JwtService

  constructor(configService: ConfigService) {
    this.jwtService = new JwtService({ secret: configService.get<string>('JWT_SECRET') })
  }

  use(request: GraphqlRequest, _response: Response, next: NextFunction): void {
    const token = getBearerToken(request)
    if (!token) {
      next()
      return
    }

    try {
      request.user = this.jwtService.verify<JwtPayload>(token)
      next()
    } catch {
      next(new UnauthorizedException('Invalid or expired token'))
    }
  }
}
