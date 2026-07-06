import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'
import { RolesService } from './roles.service'
import { AuditService } from '../audit/audit.service'

type MockPrisma = {
  role: {
    create: jest.Mock
    findFirst: jest.Mock
    findMany: jest.Mock
    findUnique: jest.Mock
    update: jest.Mock
    delete: jest.Mock
  }
  userRole: {
    findMany: jest.Mock
    findUnique: jest.Mock
    create: jest.Mock
    delete: jest.Mock
    upsert: jest.Mock
  }
  user: {
    findFirst: jest.Mock
  }
}

function makePrisma(): MockPrisma {
  return {
    role: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    userRole: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      upsert: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
    },
  }
}

describe('RolesService', () => {
  let service: RolesService
  let prisma: MockPrisma
  let auditService: { log: jest.Mock }

  const TENANT_ID = 'tenant-1'
  const ACTOR_ID = 'actor-1'
  const ROLE_ID = 'role-1'

  beforeEach(() => {
    prisma = makePrisma()
    auditService = { log: jest.fn() }
    service = new RolesService(
      prisma as unknown as ConstructorParameters<typeof RolesService>[0],
      auditService as unknown as AuditService,
    )
  })

  describe('create', () => {
    it('creates a custom role and logs audit', async () => {
      const role = { id: ROLE_ID, name: 'Viewer', description: 'Read-only', isSystem: false }
      prisma.role.create.mockResolvedValue(role)

      const result = await service.create(TENANT_ID, ACTOR_ID, {
        name: 'Viewer',
        description: 'Read-only',
      })

      expect(result).toBe(role)
      expect(prisma.role.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          name: 'Viewer',
          isSystem: false,
          createdBy: ACTOR_ID,
        }),
      })
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ROLE_CREATED',
          entity: 'Role',
          entityId: ROLE_ID,
        }),
      )
    })

    it('throws ConflictException when role name already exists', async () => {
      prisma.role.create.mockRejectedValue(
        new PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '5.22.0' }),
      )

      await expect(service.create(TENANT_ID, ACTOR_ID, { name: 'ADMIN' })).rejects.toThrow(
        ConflictException,
      )
    })

    it('rejects empty role name', async () => {
      await expect(service.create(TENANT_ID, ACTOR_ID, { name: '  ' })).rejects.toThrow(
        BadRequestException,
      )
    })
  })

  describe('delete', () => {
    it('deletes a custom role', async () => {
      prisma.role.findFirst.mockResolvedValue({ id: ROLE_ID, name: 'Custom', isSystem: false })
      prisma.role.update.mockResolvedValue({ id: ROLE_ID })

      const result = await service.delete(TENANT_ID, ACTOR_ID, ROLE_ID)

      expect(result).toBe(true)
      expect(prisma.role.update).toHaveBeenCalledWith({
        where: { id: ROLE_ID },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      })
    })

    it('rejects deletion of system roles', async () => {
      prisma.role.findFirst.mockResolvedValue({ id: ROLE_ID, name: 'ADMIN', isSystem: true })

      await expect(service.delete(TENANT_ID, ACTOR_ID, ROLE_ID)).rejects.toThrow(ForbiddenException)
    })
  })

  describe('update', () => {
    it('updates role name and description', async () => {
      prisma.role.findFirst.mockResolvedValue({ id: ROLE_ID, name: 'Custom', isSystem: false })
      const updated = { id: ROLE_ID, name: 'Renamed', description: 'Updated' }
      prisma.role.update.mockResolvedValue(updated)

      const result = await service.update(TENANT_ID, ACTOR_ID, ROLE_ID, { name: 'Renamed' })

      expect(result).toBe(updated)
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ROLE_UPDATED',
        }),
      )
    })

    it('rejects renaming of system roles', async () => {
      prisma.role.findFirst.mockResolvedValue({ id: ROLE_ID, name: 'ADMIN', isSystem: true })

      await expect(
        service.update(TENANT_ID, ACTOR_ID, ROLE_ID, { name: 'Hacked' }),
      ).rejects.toThrow(ForbiddenException)
    })
  })

  describe('assignRoleToUser', () => {
    it('assigns a role to a user', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'user-1' })
      prisma.role.findFirst.mockResolvedValue({ id: ROLE_ID, name: 'Viewer' })
      prisma.userRole.create.mockResolvedValue({ userId: 'user-1', roleId: ROLE_ID })

      const result = await service.assignRoleToUser(TENANT_ID, ACTOR_ID, 'user-1', ROLE_ID)

      expect(result).toEqual({ userId: 'user-1', roleId: ROLE_ID })
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ROLE_ASSIGNED',
        }),
      )
    })

    it('rejects duplicate assignments', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'user-1' })
      prisma.role.findFirst.mockResolvedValue({ id: ROLE_ID, name: 'Viewer' })
      prisma.userRole.create.mockRejectedValue(
        new PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '5.22.0' }),
      )

      await expect(
        service.assignRoleToUser(TENANT_ID, ACTOR_ID, 'user-1', ROLE_ID),
      ).rejects.toThrow(ConflictException)
    })
  })

  describe('findOne', () => {
    it('returns a role when found', async () => {
      const role = { id: ROLE_ID, name: 'ADMIN', isSystem: true }
      prisma.role.findFirst.mockResolvedValue(role)

      const result = await service.findOne(TENANT_ID, ROLE_ID)

      expect(result).toBe(role)
    })

    it('throws NotFoundException when role does not exist', async () => {
      prisma.role.findFirst.mockResolvedValue(null)

      await expect(service.findOne(TENANT_ID, ROLE_ID)).rejects.toThrow('Role not found')
    })
  })

  describe('findMany', () => {
    it('returns roles with user count for tenant', async () => {
      const roles = [{ id: ROLE_ID, name: 'ADMIN', _count: { userRoles: 2 } }]
      prisma.role.findMany.mockResolvedValue(roles)

      const result = await service.findMany(TENANT_ID)

      expect(result).toBe(roles)
      expect(prisma.role.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: TENANT_ID, deletedAt: null } }),
      )
    })
  })

  describe('update', () => {
    it('allows updating description of a system role', async () => {
      prisma.role.findFirst.mockResolvedValue({ id: ROLE_ID, name: 'ADMIN', isSystem: true })
      const updated = { id: ROLE_ID, name: 'ADMIN', description: 'Updated desc' }
      prisma.role.update.mockResolvedValue(updated)

      const result = await service.update(TENANT_ID, ACTOR_ID, ROLE_ID, {
        description: 'Updated desc',
      })

      expect(result).toBe(updated)
    })

    it('throws ConflictException on duplicate name during update', async () => {
      prisma.role.findFirst.mockResolvedValue({ id: ROLE_ID, name: 'Custom', isSystem: false })
      prisma.role.update.mockRejectedValue(
        new PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '5.22.0' }),
      )

      await expect(
        service.update(TENANT_ID, ACTOR_ID, ROLE_ID, { name: 'ExistingName' }),
      ).rejects.toThrow(ConflictException)
    })

    it('rejects name exceeding 100 characters', async () => {
      prisma.role.findFirst.mockResolvedValue({ id: ROLE_ID, name: 'Custom', isSystem: false })

      await expect(
        service.update(TENANT_ID, ACTOR_ID, ROLE_ID, { name: 'a'.repeat(101) }),
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('assignRoleToUser', () => {
    it('throws NotFoundException when user not found', async () => {
      prisma.user.findFirst.mockResolvedValue(null)
      prisma.role.findFirst.mockResolvedValue({ id: ROLE_ID, name: 'Viewer' })

      await expect(
        service.assignRoleToUser(TENANT_ID, ACTOR_ID, 'missing-user', ROLE_ID),
      ).rejects.toThrow('User not found')
    })

    it('throws NotFoundException when role not found', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'user-1' })
      prisma.role.findFirst.mockResolvedValue(null)

      await expect(
        service.assignRoleToUser(TENANT_ID, ACTOR_ID, 'user-1', 'missing-role'),
      ).rejects.toThrow('Role not found')
    })
  })

  describe('removeRoleFromUser', () => {
    it('throws NotFoundException when user not found', async () => {
      prisma.user.findFirst.mockResolvedValue(null)

      await expect(
        service.removeRoleFromUser(TENANT_ID, ACTOR_ID, 'missing-user', ROLE_ID),
      ).rejects.toThrow('User not found')
    })

    it('throws NotFoundException when assignment does not exist (P2025)', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'user-1' })
      prisma.userRole.delete.mockRejectedValue(
        new PrismaClientKnownRequestError('not found', { code: 'P2025', clientVersion: '5.22.0' }),
      )

      await expect(
        service.removeRoleFromUser(TENANT_ID, ACTOR_ID, 'user-1', ROLE_ID),
      ).rejects.toThrow('User does not have this role assigned')
    })

    it('logs with unknown role name when role lookup returns null', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'user-1' })
      prisma.userRole.delete.mockResolvedValue({})
      prisma.role.findUnique.mockResolvedValue(null)

      await service.removeRoleFromUser(TENANT_ID, ACTOR_ID, 'user-1', ROLE_ID)

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({ roleName: 'unknown' }),
        }),
      )
    })
  })

  describe('getUserRoles', () => {
    it('returns roles for a user filtered by tenant', async () => {
      prisma.userRole.findMany.mockResolvedValue([
        {
          userId: 'user-1',
          role: { id: ROLE_ID, name: 'ADMIN', description: null, isSystem: true },
        },
      ])

      const result = await service.getUserRoles(TENANT_ID, 'user-1')

      expect(result).toEqual([{ id: ROLE_ID, name: 'ADMIN', description: null, isSystem: true }])
    })

    it('filters out entries with null role', async () => {
      prisma.userRole.findMany.mockResolvedValue([{ userId: 'user-1', role: null }])

      const result = await service.getUserRoles(TENANT_ID, 'user-1')

      expect(result).toEqual([])
    })
  })

  describe('getUsersForRole', () => {
    it('returns users assigned to a role', async () => {
      prisma.userRole.findMany.mockResolvedValue([
        {
          user: { id: 'user-1', email: 'a@b.com', firstName: 'A', lastName: 'B' },
        },
      ])

      const result = await service.getUsersForRole(TENANT_ID, ROLE_ID)

      expect(result).toEqual([{ id: 'user-1', email: 'a@b.com', firstName: 'A', lastName: 'B' }])
    })

    it('filters out entries with null user', async () => {
      prisma.userRole.findMany.mockResolvedValue([{ user: null }])

      const result = await service.getUsersForRole(TENANT_ID, ROLE_ID)

      expect(result).toEqual([])
    })
  })
})
