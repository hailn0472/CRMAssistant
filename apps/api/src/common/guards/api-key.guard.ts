import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common'
import { GqlExecutionContext } from '@nestjs/graphql'
import * as bcrypt from 'bcryptjs'
import type { Request } from 'express'
import type { PrismaService } from '../../prisma/prisma.service'

let prismaService: PrismaService | undefined

export function registerApiKeyGuard(prisma: PrismaService): void {
  prismaService = prisma
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!prismaService) {
      throw new Error('ApiKeyGuard not initialized — call registerApiKeyGuard() first')
    }

    const gqlCtx = GqlExecutionContext.create(context)
    const ctx = gqlCtx.getContext()
    const request: Request = ctx.req

    // Read Authorization header
    const authHeader = request.headers['authorization']
    if (!authHeader || !/^Bearer\s/i.test(authHeader)) {
      throw new UnauthorizedException('Missing or invalid Authorization header')
    }
    const rawKey = authHeader.slice(7).trim()
    if (!rawKey) {
      throw new UnauthorizedException('Empty API key')
    }

    // Read tenant header
    const tenantId = request.headers['x-tenant-id'] as string
    if (!tenantId) {
      throw new UnauthorizedException('Missing x-tenant-id header')
    }

    // Look up active keys for the tenant
    const keys = await prismaService.apiKey.findMany({
      where: {
        tenantId,
        isRevoked: false,
      },
    })

    // Find matching key by bcrypt verification
    let matchedKey: (typeof keys)[number] | null = null
    for (const key of keys) {
      if (bcrypt.compareSync(rawKey, key.keyHash)) {
        matchedKey = key
        break
      }
    }

    if (!matchedKey) {
      throw new UnauthorizedException('Invalid API key')
    }

    // Check expiry
    if (matchedKey.expiresAt && new Date() > matchedKey.expiresAt) {
      throw new UnauthorizedException('API key has expired')
    }

    // Verify the owning user is still active
    const keyOwner = await prismaService.user.findUnique({
      where: { id: matchedKey.userId },
      select: { isActive: true },
    })
    if (!keyOwner?.isActive) {
      throw new UnauthorizedException('User account is inactive')
    }

    // Update lastUsedAt (fire-and-forget — must not block the request)
    prismaService.apiKey
      .update({
        where: { id: matchedKey.id },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => {
        // Non-critical — lastUsedAt update failure should not break the request
      })

    // Set user context with limited payload
    ctx.user = {
      sub: matchedKey.userId,
      userId: matchedKey.userId,
      tenantId: matchedKey.tenantId,
      roles: ['API_KEY'],
      email: '',
      apiKeyId: matchedKey.id,
      permissions: (matchedKey.permissions as string[] | null) ?? undefined,
    }

    return true
  }
}
