import { ApiKeyService } from './api-key.service'
import { PrismaService } from '../prisma/prisma.service'

describe('ApiKeyService', () => {
  let service: ApiKeyService
  let prisma: {
    apiKey: {
      create: jest.Mock
      findFirst: jest.Mock
      findMany: jest.Mock
      update: jest.Mock
    }
  }

  beforeEach(() => {
    prisma = {
      apiKey: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
    }
    service = new ApiKeyService(prisma as unknown as PrismaService)
  })

  describe('generateApiKey', () => {
    it('returns a crm_-prefixed 44-char key', () => {
      const result = service.generateApiKey()
      expect(result.rawKey).toMatch(/^crm_[a-f0-9]{40}$/)
      expect(result.rawKey.length).toBe(44)
    })

    it('keyPrefix is first 11 chars', () => {
      const result = service.generateApiKey()
      expect(result.keyPrefix).toBe(result.rawKey.slice(0, 11))
      expect(result.keyPrefix).toMatch(/^crm_[a-f0-9]{7}$/)
    })

    it('keyHash is a valid bcrypt hash', () => {
      const result = service.generateApiKey()
      expect(result.keyHash).toMatch(/^\$2[aby]\$\d+\$/)
    })
  })

  describe('hashApiKey and verifyApiKey', () => {
    it('hashApiKey produces a bcrypt hash', () => {
      const hash = service.hashApiKey('test-key-123')
      expect(hash).toMatch(/^\$2[aby]\$\d+\$/)
    })

    it('verifyApiKey matches correct key', () => {
      const { rawKey, keyHash } = service.generateApiKey()
      expect(service.verifyApiKey(rawKey, keyHash)).toBe(true)
    })

    it('verifyApiKey rejects wrong key', () => {
      const { keyHash } = service.generateApiKey()
      expect(service.verifyApiKey('wrong-key', keyHash)).toBe(false)
    })
  })

  describe('createApiKey', () => {
    it('creates a key in DB and returns raw key only once', async () => {
      const mockCreated = {
        id: 'key-1',
        name: 'Test Key',
        keyPrefix: 'crm_a1b2c3d',
        keyHash: '$2a$10$...',
        permissions: null,
        expiresAt: new Date('2026-10-01'),
      }
      prisma.apiKey.create.mockResolvedValue(mockCreated)

      const result = await service.createApiKey({
        tenantId: 'tenant-1',
        userId: 'user-1',
        name: 'Test Key',
      })

      expect(result.id).toBe('key-1')
      expect(result.name).toBe('Test Key')
      expect(result.fullKey).toBeDefined()
      expect(result.fullKey).toMatch(/^crm_/)
      expect(result.keyPrefix).toEqual(result.fullKey.slice(0, 11))
      expect(prisma.apiKey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 'tenant-1',
            userId: 'user-1',
            name: 'Test Key',
          }),
        }),
      )
    })
  })

  describe('revokeApiKey', () => {
    it('sets isRevoked=true', async () => {
      prisma.apiKey.findFirst.mockResolvedValue({ id: 'key-1', isRevoked: false })
      prisma.apiKey.update.mockResolvedValue({ id: 'key-1', isRevoked: true })

      const result = await service.revokeApiKey('key-1', 'tenant-1')
      expect(result).toBe(true)
      expect(prisma.apiKey.update).toHaveBeenCalledWith({
        where: { id: 'key-1' },
        data: { isRevoked: true, revokedAt: expect.any(Date) },
      })
    })

    it('returns false if key not found', async () => {
      prisma.apiKey.findFirst.mockResolvedValue(null)
      const result = await service.revokeApiKey('nonexistent', 'tenant-1')
      expect(result).toBe(false)
    })
  })

  describe('rotateApiKey', () => {
    it('revokes old and creates new key', async () => {
      const oldKey = {
        id: 'key-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
        name: 'Test Key',
        permissions: null,
        expiresAt: new Date('2026-10-01'),
      }
      const newCreated = {
        id: 'key-2',
        name: 'Test Key',
        keyPrefix: 'crm_x1y2z3',
        keyHash: '$2a$10$...',
        permissions: null,
        expiresAt: new Date('2026-10-01'),
      }

      prisma.apiKey.findFirst.mockResolvedValue(oldKey)
      prisma.apiKey.update.mockResolvedValue({ ...oldKey, isRevoked: true })
      prisma.apiKey.create.mockResolvedValue(newCreated)

      const result = await service.rotateApiKey('key-1', 'tenant-1')
      expect(result).not.toBeNull()
      expect(result!.fullKey).toMatch(/^crm_/)
      expect(prisma.apiKey.update).toHaveBeenCalled()
      expect(prisma.apiKey.create).toHaveBeenCalled()
    })

    it('returns null if key not found', async () => {
      prisma.apiKey.findFirst.mockResolvedValue(null)
      const result = await service.rotateApiKey('nonexistent', 'tenant-1')
      expect(result).toBeNull()
    })
  })

  describe('listApiKeys', () => {
    it('returns keys ordered by createdAt desc', async () => {
      const keys = [
        {
          id: 'key-2',
          name: 'Key 2',
          keyPrefix: 'crm_b',
          permissions: null,
          expiresAt: null,
          lastUsedAt: null,
          isRevoked: false,
          createdAt: new Date('2026-06-01'),
          updatedAt: new Date('2026-06-01'),
        },
        {
          id: 'key-1',
          name: 'Key 1',
          keyPrefix: 'crm_a',
          permissions: null,
          expiresAt: null,
          lastUsedAt: null,
          isRevoked: false,
          createdAt: new Date('2026-05-01'),
          updatedAt: new Date('2026-05-01'),
        },
      ]
      prisma.apiKey.findMany.mockResolvedValue(keys)

      const result = await service.listApiKeys('tenant-1')
      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('key-2')
    })
  })

  describe('isKeyExpired', () => {
    it('returns true when expiresAt is in the past', () => {
      const key = { expiresAt: new Date('2020-01-01') }
      expect(service.isKeyExpired(key)).toBe(true)
    })

    it('returns false when expiresAt is in the future', () => {
      const key = { expiresAt: new Date('2030-01-01') }
      expect(service.isKeyExpired(key)).toBe(false)
    })

    it('returns false when expiresAt is null', () => {
      const key = { expiresAt: null }
      expect(service.isKeyExpired(key)).toBe(false)
    })
  })

  describe('isKeyRevoked', () => {
    it('returns true when revoked', () => {
      expect(service.isKeyRevoked({ isRevoked: true })).toBe(true)
    })

    it('returns false when not revoked', () => {
      expect(service.isKeyRevoked({ isRevoked: false })).toBe(false)
    })
  })

  describe('canApiKeyPerform', () => {
    it('returns true when key has no scoped permissions', () => {
      expect(service.canApiKeyPerform(null, 'CONTACT', 'READ')).toBe(true)
      expect(service.canApiKeyPerform([], 'CONTACT', 'READ')).toBe(true)
    })

    it('returns true when key has the required permission', () => {
      expect(service.canApiKeyPerform(['CONTACT:READ'], 'CONTACT', 'READ')).toBe(true)
    })

    it('returns false when key lacks the required permission', () => {
      expect(service.canApiKeyPerform(['CONTACT:READ'], 'CONTACT', 'DELETE')).toBe(false)
    })
  })
})
