import { Injectable } from '@nestjs/common'
import * as crypto from 'node:crypto'
import * as bcrypt from 'bcryptjs'
import { PrismaService } from '../prisma/prisma.service'
import type { ApiKey } from '@prisma/client'

const API_KEY_PREFIX = 'crm_'
const API_KEY_BYTES = 20 // 40 hex chars
const DEFAULT_API_KEY_EXPIRY_DAYS = 90

export type ApiKeyCreateInput = {
  tenantId: string
  userId: string
  name: string
  expiresAt?: Date | null
  permissions?: string[] | null
}

export type ApiKeyCreateResult = {
  id: string
  name: string
  keyPrefix: string
  fullKey: string
  permissions: string[] | null
  expiresAt: Date | null
}

export type ApiKeyResult = {
  id: string
  name: string
  keyPrefix: string
  permissions: string[] | null
  expiresAt: Date | null
  lastUsedAt: Date | null
  isRevoked: boolean
  createdAt: Date
  updatedAt: Date
}

function generateRawKey(): string {
  const random = crypto.randomBytes(API_KEY_BYTES).toString('hex')
  return `${API_KEY_PREFIX}${random}`
}

function extractKeyPrefix(rawKey: string): string {
  return rawKey.slice(0, 11)
}

@Injectable()
export class ApiKeyService {
  constructor(private readonly prisma: PrismaService) {}

  generateApiKey(): { rawKey: string; keyPrefix: string; keyHash: string } {
    const rawKey = generateRawKey()
    const keyPrefix = extractKeyPrefix(rawKey)
    const keyHash = bcrypt.hashSync(rawKey, 10)
    return { rawKey, keyPrefix, keyHash }
  }

  hashApiKey(rawKey: string): string {
    return bcrypt.hashSync(rawKey, 10)
  }

  verifyApiKey(rawKey: string, keyHash: string): boolean {
    return bcrypt.compareSync(rawKey, keyHash)
  }

  async createApiKey(input: ApiKeyCreateInput): Promise<ApiKeyCreateResult> {
    const { rawKey, keyPrefix, keyHash } = this.generateApiKey()

    const expiryDaysRaw = parseInt(
      process.env.API_KEY_EXPIRY_DAYS ?? String(DEFAULT_API_KEY_EXPIRY_DAYS),
      10,
    )
    const expiryDays =
      !isNaN(expiryDaysRaw) && expiryDaysRaw > 0 ? expiryDaysRaw : DEFAULT_API_KEY_EXPIRY_DAYS
    const expiresAt = input.expiresAt ?? new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000)

    const key = await this.prisma.apiKey.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        name: input.name,
        keyPrefix,
        keyHash,
        permissions: input.permissions ?? undefined,
        expiresAt,
      },
    })

    return {
      id: key.id,
      name: key.name,
      keyPrefix,
      fullKey: rawKey,
      permissions: key.permissions as string[] | null,
      expiresAt: key.expiresAt,
    }
  }

  async revokeApiKey(id: string, tenantId: string): Promise<boolean> {
    const key = await this.prisma.apiKey.findFirst({
      where: { id, tenantId, isRevoked: false },
    })
    if (!key) return false

    await this.prisma.apiKey.update({
      where: { id },
      data: { isRevoked: true, revokedAt: new Date() },
    })
    return true
  }

  async rotateApiKey(id: string, tenantId: string): Promise<ApiKeyCreateResult | null> {
    const existing = await this.prisma.apiKey.findFirst({
      where: { id, tenantId, isRevoked: false },
    })
    if (!existing) return null

    // Revoke the old key
    await this.prisma.apiKey.update({
      where: { id },
      data: { isRevoked: true, revokedAt: new Date() },
    })

    // Create new key with same properties
    return this.createApiKey({
      tenantId,
      userId: existing.userId,
      name: existing.name,
      permissions: existing.permissions as string[] | null,
      expiresAt: existing.expiresAt,
    })
  }

  async listApiKeys(tenantId: string, userId?: string): Promise<ApiKeyResult[]> {
    const where: { tenantId: string; userId?: string } = { tenantId }
    if (userId) where.userId = userId

    const keys = await this.prisma.apiKey.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    })

    return keys.map((key) => ({
      id: key.id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      permissions: key.permissions as string[] | null,
      expiresAt: key.expiresAt,
      lastUsedAt: key.lastUsedAt,
      isRevoked: key.isRevoked,
      createdAt: key.createdAt,
      updatedAt: key.updatedAt,
    }))
  }

  async findByKeyPrefix(tenantId: string, keyPrefix: string): Promise<ApiKey | null> {
    return this.prisma.apiKey.findFirst({
      where: { tenantId, keyPrefix },
    })
  }

  isKeyExpired(key: { expiresAt: Date | null }): boolean {
    if (!key.expiresAt) return false
    return new Date() > key.expiresAt
  }

  isKeyRevoked(key: { isRevoked: boolean }): boolean {
    return key.isRevoked
  }

  canApiKeyPerform(
    keyPermissions: string[] | null,
    requiredResource: string,
    requiredAction: string,
  ): boolean {
    if (!keyPermissions || keyPermissions.length === 0) {
      // No permissions scoped = key can access everything the user can
      return true
    }
    const required = `${requiredResource}:${requiredAction}`
    return keyPermissions.includes(required)
  }
}
