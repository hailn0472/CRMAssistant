import { UnauthorizedException } from '@nestjs/common'

// Mock bcrypt before importing the guard
const mockCompareSync = jest.fn()
jest.mock('bcryptjs', () => ({
  compareSync: (...args: unknown[]): boolean => mockCompareSync(...args) as boolean,
}))

// Mock GqlExecutionContext
const mockGetInfo = jest.fn()
const mockGetContext = jest.fn()
const mockGetArgs = jest.fn()

jest.mock('@nestjs/graphql', () => ({
  GqlExecutionContext: {
    create: jest.fn().mockReturnValue({
      getInfo: mockGetInfo,
      getContext: mockGetContext,
      getArgs: mockGetArgs,
    }),
  },
}))

import { registerApiKeyGuard, ApiKeyGuard } from './api-key.guard'
import type { PrismaService } from '../../prisma/prisma.service'

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard
  let prisma: {
    apiKey: {
      findMany: jest.Mock
      update: jest.Mock
    }
    user: {
      findUnique: jest.Mock
    }
  }

  beforeEach(() => {
    jest.clearAllMocks()
    prisma = {
      apiKey: {
        findMany: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
      },
    }

    registerApiKeyGuard(prisma as unknown as PrismaService)
    guard = new ApiKeyGuard()
  })

  function setContext(headers: Record<string, string>): void {
    mockGetInfo.mockReturnValue({ fieldName: 'test', parentType: { name: 'Query' } })
    mockGetContext.mockReturnValue({
      req: { headers },
      user: null,
    })
    mockGetArgs.mockReturnValue({})
  }

  it('rejects request without Authorization header', async () => {
    setContext({ 'x-tenant-id': 'tenant-1' })

    await expect(guard.canActivate({} as never)).rejects.toThrow(UnauthorizedException)
  })

  it('rejects request without Bearer prefix', async () => {
    setContext({ authorization: 'Basic abc123', 'x-tenant-id': 'tenant-1' })

    await expect(guard.canActivate({} as never)).rejects.toThrow(UnauthorizedException)
  })

  it('rejects request with empty API key', async () => {
    setContext({ authorization: 'Bearer ', 'x-tenant-id': 'tenant-1' })

    await expect(guard.canActivate({} as never)).rejects.toThrow(UnauthorizedException)
  })

  it('rejects request without x-tenant-id header', async () => {
    setContext({ authorization: 'Bearer crm_abc123' })

    await expect(guard.canActivate({} as never)).rejects.toThrow(UnauthorizedException)
  })

  it('rejects request with invalid key', async () => {
    setContext({ authorization: 'Bearer crm_invalid', 'x-tenant-id': 'tenant-1' })
    prisma.apiKey.findMany.mockResolvedValue([
      {
        id: 'key-1',
        tenantId: 'tenant-1',
        keyHash: '$2a$10$hash',
        isRevoked: false,
        expiresAt: null,
        userId: 'user-1',
        permissions: null,
      },
    ])
    mockCompareSync.mockReturnValue(false)
    prisma.user.findUnique.mockResolvedValue({ isActive: true })

    await expect(guard.canActivate({} as never)).rejects.toThrow(UnauthorizedException)
  })

  it('rejects request with expired key', async () => {
    setContext({ authorization: 'Bearer crm_expired', 'x-tenant-id': 'tenant-1' })
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)

    prisma.apiKey.findMany.mockResolvedValue([
      {
        id: 'key-1',
        tenantId: 'tenant-1',
        keyHash: '$2a$10$hash',
        isRevoked: false,
        expiresAt: yesterday,
        userId: 'user-1',
        permissions: null,
      },
    ])
    mockCompareSync.mockReturnValue(true)
    prisma.user.findUnique.mockResolvedValue({ isActive: true })

    await expect(guard.canActivate({} as never)).rejects.toThrow(UnauthorizedException)
  })

  it('passes with valid key and sets user context', async () => {
    setContext({ authorization: 'Bearer crm_valid', 'x-tenant-id': 'tenant-1' })
    const futureDate = new Date()
    futureDate.setDate(futureDate.getDate() + 30)

    prisma.apiKey.findMany.mockResolvedValue([
      {
        id: 'key-1',
        tenantId: 'tenant-1',
        keyHash: '$2a$10$hash',
        isRevoked: false,
        expiresAt: futureDate,
        userId: 'user-1',
      },
    ])
    mockCompareSync.mockReturnValue(true)
    prisma.apiKey.update.mockResolvedValue({})
    prisma.user.findUnique.mockResolvedValue({ isActive: true })

    const result = await guard.canActivate({} as never)
    expect(result).toBe(true)

    // Verify user context was set on the GQL context
    const gqlCtx = mockGetContext()
    expect(gqlCtx.user).toBeDefined()
    expect(gqlCtx.user.userId).toBe('user-1')
    expect(gqlCtx.user.tenantId).toBe('tenant-1')
    expect(gqlCtx.user.roles).toEqual(['API_KEY'])
    expect(gqlCtx.user.apiKeyId).toBe('key-1')
  })
})
