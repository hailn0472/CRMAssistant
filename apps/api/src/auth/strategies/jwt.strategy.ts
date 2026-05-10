import { Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'

import { TokenRevocationService } from '../token-revocation.service'
import type { Request } from 'express'

export type JwtPayload = {
  sub: string
  userId: string
  tenantId: string
  role: string
  email: string
}

function getRequiredJwtSecret(configService: ConfigService): string {
  const secret = configService.get<string>('JWT_SECRET')
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set and contain at least 32 characters')
  }
  return secret
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly tokenRevocationService: TokenRevocationService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      passReqToCallback: true,
      secretOrKey: getRequiredJwtSecret(configService),
    })
  }

  validate(request: Request, payload: JwtPayload): JwtPayload {
    const token = ExtractJwt.fromAuthHeaderAsBearerToken()(request)
    if (token && this.tokenRevocationService.isRevoked(token)) {
      throw new UnauthorizedException('Token has been revoked')
    }

    if (!payload.sub || !payload.userId || payload.sub !== payload.userId || !payload.tenantId) {
      throw new UnauthorizedException('Invalid token payload')
    }
    return payload
  }
}
