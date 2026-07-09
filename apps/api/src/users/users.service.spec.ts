import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'

import { UsersService } from './users.service'
import type { User } from '@prisma/client'

type MockUserDelegate = {
  create: jest.Mock
  findFirst: jest.Mock
  findMany: jest.Mock
  count: jest.Mock
  updateMany: jest.Mock
}

type MockPrisma = {
  user: MockUserDelegate
  role: { findFirst: jest.Mock }
  userRole: { findUnique: jest.Mock; create: jest.Mock; findMany: jest.Mock }
  tenant: { update: jest.Mock; findFirst: jest.Mock }
}

const NOW = new Date('2026-06-01T00:00:00.000Z')
const TENANT_ID = 'tenant-1'
const OTHER_TENANT_ID = 'tenant-2'
const USER_ID = 'user-1'
const TARGET_USER_ID = 'user-2'

function makeUser(overrides: Record<string, unknown> = {}): User {
  return {
    id: TARGET_USER_ID,
    tenantId: TENANT_ID,
    email: 'ada@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    avatar: null,
    phone: null,
    jobTitle: null,
    department: null,
    isActive: true,
    supabaseUserId: null,
    lastLoginAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: USER_ID,
    updatedBy: USER_ID,
    deletedAt: null,
    ...overrides,
  } as User
}

function makePrisma(): MockPrisma {
  return {
    user: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
    role: {
      findFirst: jest.fn(),
    },
    userRole: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
    },
    tenant: {
      update: jest.fn(),
      findFirst: jest.fn(),
    },
  }
}

function makeTwoFactorService() {
  return {
    generateSecret: jest.fn().mockReturnValue('MOCK_SECRET'),
    generateQrCodeDataUrl: jest.fn().mockResolvedValue('data:image/png;base64,mock'),
    verifyTotp: jest.fn().mockResolvedValue(true),
    generateBackupCodes: jest.fn().mockReturnValue(Array.from({ length: 10 }, (_, i) => `CODE${i}`)),
    hashBackupCodes: jest.fn().mockImplementation((codes: string[]) => Promise.resolve(codes.map((c) => `hashed_${c}`))),
    verifyBackupCode: jest.fn().mockResolvedValue(-1),
  }
}

function makeAuditService() {
  return {
    log: jest.fn().mockResolvedValue(undefined),
  }
}

describe('UsersService', () => {
  let service: UsersService
  let prisma: MockPrisma

  beforeEach(() => {
    prisma = makePrisma()
    service = new UsersService(
      prisma as unknown as ConstructorParameters<typeof UsersService>[0],
      makeTwoFactorService() as never,
      makeAuditService() as never,
      {} as never, // AuthService mock — not needed for existing tests
    )
  })

  describe('create()', () => {
    it('creates a user scoped to authenticated tenant and user', async () => {
      const user = makeUser()
      prisma.user.create.mockResolvedValue(user)
      prisma.role.findFirst.mockResolvedValue(null) // no SALES_REP role for this test

      const result = await service.create(TENANT_ID, USER_ID, {
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
      })

      expect(result).toBe(user)
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          tenantId: TENANT_ID,
          email: 'ada@example.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
          phone: undefined,
          jobTitle: undefined,
          department: undefined,
          createdBy: USER_ID,
          updatedBy: USER_ID,
        },
      })
    })

    it('throws ConflictException for duplicate email in the same tenant', async () => {
      prisma.user.create.mockRejectedValue(
        new PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.22.0',
        }),
      )

      await expect(
        service.create(TENANT_ID, USER_ID, {
          email: 'ada@example.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
        }),
      ).rejects.toThrow(ConflictException)
    })

    it('normalizes optional empty strings and trims fields', async () => {
      const user = makeUser()
      prisma.user.create.mockResolvedValue(user)

      await service.create(TENANT_ID, USER_ID, {
        email: ' Ada@Example.COM ',
        firstName: ' Ada ',
        lastName: ' Lovelace ',
        phone: '   ',
        jobTitle: ' Engineer ',
        department: ' Engineering ',
      })

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'ada@example.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
          phone: undefined,
          jobTitle: 'Engineer',
          department: 'Engineering',
        }) as Record<string, unknown>,
      })
    })

    it('rejects blank required fields', async () => {
      await expect(
        service.create(TENANT_ID, USER_ID, {
          email: 'ada@example.com',
          firstName: '   ',
          lastName: 'Lovelace',
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects overly long required fields', async () => {
      await expect(
        service.create(TENANT_ID, USER_ID, {
          email: 'ada@example.com',
          firstName: 'A'.repeat(101),
          lastName: 'Lovelace',
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects invalid emails', async () => {
      await expect(
        service.create(TENANT_ID, USER_ID, {
          email: 'not-an-email',
          firstName: 'Ada',
          lastName: 'Lovelace',
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects overly long optional fields', async () => {
      await expect(
        service.create(TENANT_ID, USER_ID, {
          email: 'ada@example.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
          jobTitle: 'A'.repeat(201),
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects invalid email', async () => {
      await expect(
        service.create(TENANT_ID, USER_ID, {
          email: 'not-an-email',
          firstName: 'Ada',
          lastName: 'Lovelace',
        }),
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('findOne()', () => {
    it('returns active user scoped to tenant', async () => {
      const user = makeUser()
      prisma.user.findFirst.mockResolvedValue(user)

      await expect(service.findOne(TENANT_ID, TARGET_USER_ID)).resolves.toBe(user)
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: TARGET_USER_ID, tenantId: TENANT_ID, deletedAt: null },
      })
    })

    it('throws NotFoundException for cross-tenant or deleted users', async () => {
      prisma.user.findFirst.mockResolvedValue(null)

      await expect(service.findOne(OTHER_TENANT_ID, TARGET_USER_ID)).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  describe('findMe()', () => {
    it('returns the authenticated user', async () => {
      const user = makeUser({ id: USER_ID })
      prisma.user.findFirst.mockResolvedValue(user)

      await expect(service.findMe(TENANT_ID, USER_ID)).resolves.toBe(user)
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: USER_ID, tenantId: TENANT_ID, deletedAt: null },
      })
    })

    it('throws NotFoundException if own account is missing', async () => {
      prisma.user.findFirst.mockResolvedValue(null)

      await expect(service.findMe(TENANT_ID, USER_ID)).rejects.toThrow(NotFoundException)
    })
  })

  describe('findMany()', () => {
    it('returns paginated active tenant users and total count', async () => {
      const user = makeUser()
      prisma.user.findMany.mockResolvedValue([user])
      prisma.user.count.mockResolvedValue(1)

      const result = await service.findMany(TENANT_ID, {}, { page: 2, pageSize: 10 })

      expect(result).toEqual({ items: [user], total: 1, page: 2, pageSize: 10 })
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
        }) as Record<string, unknown>,
      )
    })

    it('filters by isActive', async () => {
      prisma.user.findMany.mockResolvedValue([])
      prisma.user.count.mockResolvedValue(0)

      const result = await service.findMany(TENANT_ID, { isActive: true })

      expect(result.items).toEqual([])
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isActive: true,
          }) as Record<string, unknown>,
        }) as Record<string, unknown>,
      )
    })

    it('filters by isActive only (role filter removed in Story 2.2)', async () => {
      prisma.user.findMany.mockResolvedValue([])
      prisma.user.count.mockResolvedValue(0)

      await service.findMany(TENANT_ID, { isActive: true })

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isActive: true,
          }) as Record<string, unknown>,
        }) as Record<string, unknown>,
      )
    })

    it('filters by search across email, firstName, lastName', async () => {
      prisma.user.findMany.mockResolvedValue([])
      prisma.user.count.mockResolvedValue(0)

      await service.findMany(TENANT_ID, { search: 'ada' })

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { email: { contains: 'ada', mode: 'insensitive' } },
              { firstName: { contains: 'ada', mode: 'insensitive' } },
              { lastName: { contains: 'ada', mode: 'insensitive' } },
            ],
          }) as Record<string, unknown>,
        }) as Record<string, unknown>,
      )
    })
  })

  describe('update()', () => {
    it('updates only active users in the authenticated tenant', async () => {
      const updated = makeUser({ firstName: 'Updated' })
      prisma.user.updateMany.mockResolvedValue({ count: 1 })
      prisma.user.findFirst.mockResolvedValue(updated)

      const result = await service.update(TENANT_ID, USER_ID, TARGET_USER_ID, {
        firstName: 'Updated',
      })

      expect(result).toBe(updated)
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: TARGET_USER_ID, tenantId: TENANT_ID, deletedAt: null },
        data: { firstName: 'Updated', updatedBy: USER_ID },
      })
    })

    it('throws NotFoundException when update finds no active user', async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 0 })

      await expect(
        service.update(TENANT_ID, USER_ID, TARGET_USER_ID, { firstName: 'Updated' }),
      ).rejects.toThrow(NotFoundException)
    })

    it('converts duplicate email errors on update', async () => {
      prisma.user.updateMany.mockRejectedValue(
        new PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.22.0',
        }),
      )

      await expect(
        service.update(TENANT_ID, USER_ID, TARGET_USER_ID, { email: 'ada@example.com' }),
      ).rejects.toThrow(ConflictException)
    })
  })

  describe('updateProfile()', () => {
    it('updates the authenticated user profile', async () => {
      const updated = makeUser({ id: USER_ID, lastName: 'Smith' })
      prisma.user.updateMany.mockResolvedValue({ count: 1 })
      prisma.user.findFirst.mockResolvedValue(updated)

      const result = await service.updateProfile(TENANT_ID, USER_ID, { lastName: 'Smith' })

      expect(result).toBe(updated)
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: USER_ID, tenantId: TENANT_ID, deletedAt: null },
        data: { lastName: 'Smith', updatedBy: USER_ID },
      })
    })

    it('throws NotFoundException when profile user not found', async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 0 })

      await expect(service.updateProfile(TENANT_ID, USER_ID, { firstName: 'New' })).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  describe('delete()', () => {
    it('soft deletes only active users in the authenticated tenant', async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 1 })

      await expect(service.delete(TENANT_ID, USER_ID, TARGET_USER_ID)).resolves.toBe(true)
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: TARGET_USER_ID, tenantId: TENANT_ID, deletedAt: null },
        data: { deletedAt: expect.any(Date) as Date, updatedBy: USER_ID },
      })
    })

    it('throws NotFoundException when no active user is deleted', async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 0 })

      await expect(service.delete(TENANT_ID, USER_ID, TARGET_USER_ID)).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  describe('deactivate()', () => {
    it('sets isActive to false for a single user', async () => {
      const deactivated = makeUser({ isActive: false })
      prisma.user.updateMany.mockResolvedValue({ count: 1 })
      prisma.user.findFirst.mockResolvedValue(deactivated)

      const result = await service.deactivate(TENANT_ID, USER_ID, TARGET_USER_ID)

      expect(result.isActive).toBe(false)
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: TARGET_USER_ID, tenantId: TENANT_ID, deletedAt: null },
        data: { isActive: false, updatedBy: USER_ID },
      })
    })

    it('throws NotFoundException when user not found', async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 0 })

      await expect(service.deactivate(TENANT_ID, USER_ID, TARGET_USER_ID)).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  describe('reactivate()', () => {
    it('sets isActive to true for a single user', async () => {
      const reactivated = makeUser({ isActive: true })
      prisma.user.updateMany.mockResolvedValue({ count: 1 })
      prisma.user.findFirst.mockResolvedValue(reactivated)

      const result = await service.reactivate(TENANT_ID, USER_ID, TARGET_USER_ID)

      expect(result.isActive).toBe(true)
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: TARGET_USER_ID, tenantId: TENANT_ID, deletedAt: null },
        data: { isActive: true, updatedBy: USER_ID },
      })
    })

    it('throws NotFoundException when user not found', async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 0 })

      await expect(service.reactivate(TENANT_ID, USER_ID, TARGET_USER_ID)).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  describe('deactivateUsers()', () => {
    it('bulk deactivates multiple users and returns count', async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 3 })

      const result = await service.deactivateUsers(TENANT_ID, USER_ID, [
        'user-a',
        'user-b',
        'user-c',
      ])

      expect(result).toBe(3)
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['user-a', 'user-b', 'user-c'] }, tenantId: TENANT_ID, deletedAt: null },
        data: { isActive: false, updatedBy: USER_ID },
      })
    })
  })

  describe('reactivateUsers()', () => {
    it('bulk reactivates multiple users and returns count', async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 2 })

      const result = await service.reactivateUsers(TENANT_ID, USER_ID, ['user-a', 'user-b'])

      expect(result).toBe(2)
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['user-a', 'user-b'] }, tenantId: TENANT_ID, deletedAt: null },
        data: { isActive: true, updatedBy: USER_ID },
      })
    })
  })

  describe('pagination edge cases', () => {
    it('uses default pagination bounds', async () => {
      prisma.user.findMany.mockResolvedValue([])
      prisma.user.count.mockResolvedValue(0)

      const result = await service.findMany(TENANT_ID)

      expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 20 })
    })

    it('caps pagination bounds', async () => {
      prisma.user.findMany.mockResolvedValue([])
      prisma.user.count.mockResolvedValue(0)

      const result = await service.findMany(TENANT_ID, {}, { page: 0, pageSize: 500 })

      expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 100 })
    })
  })

  describe('getUserRoles()', () => {
    it('returns roles for a user filtered by tenantId', async () => {
      prisma.userRole.findMany.mockResolvedValue([
        { userId: TARGET_USER_ID, role: { id: 'role-1', name: 'ADMIN' } },
      ])

      const result = await service.getUserRoles(TENANT_ID, TARGET_USER_ID)

      expect(result).toEqual([{ id: 'role-1', name: 'ADMIN' }])
      expect(prisma.userRole.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: TARGET_USER_ID, role: { tenantId: TENANT_ID } },
        }),
      )
    })

    it('filters out null roles', async () => {
      prisma.userRole.findMany.mockResolvedValue([{ userId: TARGET_USER_ID, role: null }])

      const result = await service.getUserRoles(TENANT_ID, TARGET_USER_ID)

      expect(result).toEqual([])
    })
  })

  describe('getUserRolesBatch()', () => {
    it('returns empty map for empty userIds array', async () => {
      const result = await service.getUserRolesBatch(TENANT_ID, [])

      expect(result.size).toBe(0)
      expect(prisma.userRole.findMany).not.toHaveBeenCalled()
    })

    it('returns roles grouped by userId', async () => {
      prisma.userRole.findMany.mockResolvedValue([
        { userId: 'user-1', role: { id: 'role-1', name: 'ADMIN' } },
        { userId: 'user-2', role: { id: 'role-2', name: 'SALES_REP' } },
        { userId: 'user-1', role: { id: 'role-3', name: 'SALES_MANAGER' } },
      ])

      const result = await service.getUserRolesBatch(TENANT_ID, ['user-1', 'user-2'])

      expect(result.get('user-1')).toEqual([
        { id: 'role-1', name: 'ADMIN' },
        { id: 'role-3', name: 'SALES_MANAGER' },
      ])
      expect(result.get('user-2')).toEqual([{ id: 'role-2', name: 'SALES_REP' }])
    })

    it('initializes empty array for users with no roles', async () => {
      prisma.userRole.findMany.mockResolvedValue([])

      const result = await service.getUserRolesBatch(TENANT_ID, ['user-no-roles'])

      expect(result.get('user-no-roles')).toEqual([])
    })
  })

  describe('error rethrow', () => {
    it('rethrows unknown create errors', async () => {
      prisma.user.create.mockRejectedValue(new Error('database unavailable'))

      await expect(
        service.create(TENANT_ID, USER_ID, {
          email: 'ada@example.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
        }),
      ).rejects.toThrow('database unavailable')
    })

    it('rethrows unknown update errors', async () => {
      prisma.user.updateMany.mockRejectedValue(new Error('database unavailable'))

      await expect(
        service.update(TENANT_ID, USER_ID, TARGET_USER_ID, { firstName: 'X' }),
      ).rejects.toThrow('database unavailable')
    })
  })
})
