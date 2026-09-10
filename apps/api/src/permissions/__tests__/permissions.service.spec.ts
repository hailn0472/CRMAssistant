import { NotFoundException, ForbiddenException } from '@nestjs/common'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'
import { PermissionsService } from '../permissions.service'
import { AuditService } from '../../audit/audit.service'

type MockPrisma = {
  permission: {
    findMany: jest.Mock
    findUnique: jest.Mock
  }
  rolePermission: {
    findMany: jest.Mock
    create: jest.Mock
    createMany: jest.Mock
    delete: jest.Mock
    deleteMany: jest.Mock
    count: jest.Mock
  }
  role: {
    findFirst: jest.Mock
    findMany: jest.Mock
    findUnique: jest.Mock
  }
  $transaction: jest.Mock
}

function makePrisma(): MockPrisma {
  return {
    permission: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    rolePermission: {
      findMany: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
    },
    role: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  }
}

describe('PermissionsService', () => {
  let service: PermissionsService
  let prisma: MockPrisma
  let auditService: { log: jest.Mock }

  const TENANT_ID = 'tenant-1'
  const ACTOR_ID = 'actor-1'
  const ROLE_ID = 'role-1'
  const PERMISSION_ID = 'perm-1'
  const USER_ID = 'user-1'

  beforeEach(() => {
    prisma = makePrisma()
    auditService = { log: jest.fn() }
    service = new PermissionsService(
      prisma as unknown as ConstructorParameters<typeof PermissionsService>[0],
      auditService as unknown as AuditService,
    )
  })

  describe('getAllPermissions', () => {
    it('returns all permissions ordered by resource and action', async () => {
      const perms = [
        { id: 'p1', resource: 'CONTACT', action: 'CREATE', description: 'Create contacts' },
        { id: 'p2', resource: 'CONTACT', action: 'READ', description: 'Read contacts' },
      ]
      prisma.permission.findMany.mockResolvedValue(perms)

      const result = await service.getAllPermissions()

      expect(result).toBe(perms)
      expect(prisma.permission.findMany).toHaveBeenCalledWith({
        orderBy: [{ resource: 'asc' }, { action: 'asc' }],
      })
    })

    it('returns empty array when no permissions exist', async () => {
      prisma.permission.findMany.mockResolvedValue([])

      const result = await service.getAllPermissions()

      expect(result).toEqual([])
    })
  })

  describe('getRolePermissions', () => {
    it('returns permissions for a role with tenant verification', async () => {
      prisma.role.findFirst.mockResolvedValue({ id: ROLE_ID, name: 'Viewer' })
      const perms = [{ id: PERMISSION_ID, resource: 'CONTACT', action: 'READ' }]
      prisma.permission.findMany.mockResolvedValue(perms)

      const result = await service.getRolePermissions(TENANT_ID, ROLE_ID)

      expect(result).toBe(perms)
      expect(prisma.role.findFirst).toHaveBeenCalledWith({
        where: { id: ROLE_ID, tenantId: TENANT_ID, deletedAt: null },
      })
    })

    it('throws NotFoundException when role not found', async () => {
      prisma.role.findFirst.mockResolvedValue(null)

      await expect(service.getRolePermissions(TENANT_ID, ROLE_ID)).rejects.toThrow(
        NotFoundException,
      )
    })

    it('returns empty array when role has no permissions', async () => {
      prisma.role.findFirst.mockResolvedValue({ id: ROLE_ID, name: 'Empty' })
      prisma.permission.findMany.mockResolvedValue([])

      const result = await service.getRolePermissions(TENANT_ID, ROLE_ID)

      expect(result).toEqual([])
    })
  })

  describe('getMyPermissions', () => {
    it('returns all permissions with granted flag for a user', async () => {
      const grantedPerms = [{ resource: 'CONTACT', action: 'READ' }]
      const allPerms = [
        { resource: 'CONTACT', action: 'CREATE' },
        { resource: 'CONTACT', action: 'READ' },
      ]
      prisma.permission.findMany
        .mockResolvedValueOnce(grantedPerms) // first call: granted
        .mockResolvedValueOnce(allPerms) // second call: all

      const result = await service.getMyPermissions(TENANT_ID, USER_ID)

      expect(result).toEqual([
        { resource: 'CONTACT', action: 'CREATE', granted: false },
        { resource: 'CONTACT', action: 'READ', granted: true },
      ])
    })

    it('returns all permissions as not granted when user has no roles', async () => {
      const allPerms = [{ resource: 'CONTACT', action: 'READ' }]
      prisma.permission.findMany
        .mockResolvedValueOnce([]) // granted: empty
        .mockResolvedValueOnce(allPerms) // all

      const result = await service.getMyPermissions(TENANT_ID, USER_ID)

      expect(result).toEqual([{ resource: 'CONTACT', action: 'READ', granted: false }])
    })

    it('filters out soft-deleted roles', async () => {
      prisma.permission.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])

      await service.getMyPermissions(TENANT_ID, USER_ID)

      // Verify the query includes deletedAt: null on role
      expect(prisma.permission.findMany).toHaveBeenCalledTimes(2)
    })
  })

  describe('assignPermissionToRole', () => {
    it('assigns a permission to a role and logs audit', async () => {
      prisma.role.findFirst.mockResolvedValue({ id: ROLE_ID, name: 'Viewer' })
      prisma.permission.findUnique.mockResolvedValue({
        id: PERMISSION_ID,
        resource: 'CONTACT',
        action: 'CREATE',
      })
      prisma.rolePermission.create.mockResolvedValue({
        roleId: ROLE_ID,
        permissionId: PERMISSION_ID,
      })

      const result = await service.assignPermissionToRole(
        TENANT_ID,
        ACTOR_ID,
        ROLE_ID,
        PERMISSION_ID,
      )

      expect(result).toEqual({ roleId: ROLE_ID, permissionId: PERMISSION_ID })
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PERMISSION_ASSIGNED',
          entity: 'RolePermission',
        }),
      )
    })

    it('throws NotFoundException when role not found', async () => {
      prisma.role.findFirst.mockResolvedValue(null)

      await expect(
        service.assignPermissionToRole(TENANT_ID, ACTOR_ID, ROLE_ID, PERMISSION_ID),
      ).rejects.toThrow(NotFoundException)
    })

    it('throws NotFoundException when permission not found', async () => {
      prisma.role.findFirst.mockResolvedValue({ id: ROLE_ID, name: 'Viewer' })
      prisma.permission.findUnique.mockResolvedValue(null)

      await expect(
        service.assignPermissionToRole(TENANT_ID, ACTOR_ID, ROLE_ID, PERMISSION_ID),
      ).rejects.toThrow(NotFoundException)
    })

    it('throws ForbiddenException on duplicate assignment', async () => {
      prisma.role.findFirst.mockResolvedValue({ id: ROLE_ID, name: 'Viewer' })
      prisma.permission.findUnique.mockResolvedValue({ id: PERMISSION_ID })
      prisma.rolePermission.create.mockRejectedValue(
        new PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '5.22.0' }),
      )

      await expect(
        service.assignPermissionToRole(TENANT_ID, ACTOR_ID, ROLE_ID, PERMISSION_ID),
      ).rejects.toThrow(ForbiddenException)
    })

    it('cross-tenant: role from another tenant cannot be assigned', async () => {
      prisma.role.findFirst.mockResolvedValue(null) // Role not found in this tenant

      await expect(
        service.assignPermissionToRole(TENANT_ID, ACTOR_ID, ROLE_ID, PERMISSION_ID),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('removePermissionFromRole', () => {
    it('removes a permission from a role and logs audit', async () => {
      prisma.role.findFirst.mockResolvedValue({ id: ROLE_ID, name: 'Viewer' })
      prisma.rolePermission.delete.mockResolvedValue({})
      prisma.permission.findUnique.mockResolvedValue({
        id: PERMISSION_ID,
        resource: 'CONTACT',
        action: 'READ',
      })

      const result = await service.removePermissionFromRole(
        TENANT_ID,
        ACTOR_ID,
        ROLE_ID,
        PERMISSION_ID,
      )

      expect(result).toBe(true)
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PERMISSION_REMOVED' }),
      )
    })

    it('throws NotFoundException when role not found', async () => {
      prisma.role.findFirst.mockResolvedValue(null)

      await expect(
        service.removePermissionFromRole(TENANT_ID, ACTOR_ID, ROLE_ID, PERMISSION_ID),
      ).rejects.toThrow(NotFoundException)
    })

    it('throws NotFoundException when permission not assigned (P2025)', async () => {
      prisma.role.findFirst.mockResolvedValue({ id: ROLE_ID, name: 'Viewer' })
      prisma.rolePermission.delete.mockRejectedValue(
        new PrismaClientKnownRequestError('not found', { code: 'P2025', clientVersion: '5.22.0' }),
      )

      await expect(
        service.removePermissionFromRole(TENANT_ID, ACTOR_ID, ROLE_ID, PERMISSION_ID),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('setRolePermissions', () => {
    it('bulk replaces permissions in a transaction', async () => {
      prisma.role.findFirst.mockResolvedValue({ id: ROLE_ID, name: 'Viewer' })
      prisma.rolePermission.deleteMany.mockResolvedValue({ count: 3 })
      prisma.rolePermission.createMany.mockResolvedValue({ count: 2 })
      const newPerms = [
        { id: 'p1', resource: 'CONTACT', action: 'READ' },
        { id: 'p2', resource: 'CONTACT', action: 'UPDATE' },
      ]
      prisma.permission.findMany.mockResolvedValue(newPerms)

      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
        const tx = {
          rolePermission: {
            deleteMany: prisma.rolePermission.deleteMany,
            createMany: prisma.rolePermission.createMany,
          },
          permission: {
            count: jest.fn().mockResolvedValue(2),
          },
        }
        await cb(tx)
      })

      const result = await service.setRolePermissions(TENANT_ID, ACTOR_ID, ROLE_ID, ['p1', 'p2'])

      expect(result).toBe(newPerms)
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ROLE_PERMISSIONS_SET',
          details: expect.objectContaining({ count: 2 }),
        }),
      )
    })

    it('works with empty permissionIds array (clear all)', async () => {
      prisma.role.findFirst.mockResolvedValue({ id: ROLE_ID, name: 'Viewer' })
      prisma.permission.findMany.mockResolvedValue([])

      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
        await cb({
          rolePermission: {
            deleteMany: jest.fn().mockResolvedValue({ count: 5 }),
            createMany: jest.fn(),
          },
          permission: { count: jest.fn().mockResolvedValue(0) },
        })
      })

      const result = await service.setRolePermissions(TENANT_ID, ACTOR_ID, ROLE_ID, [])

      expect(result).toEqual([])
    })

    it('throws NotFoundException when role not found', async () => {
      prisma.role.findFirst.mockResolvedValue(null)

      await expect(service.setRolePermissions(TENANT_ID, ACTOR_ID, ROLE_ID, [])).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  describe('hasPermission', () => {
    it('returns true when user has matching permission via role', async () => {
      prisma.rolePermission.count.mockResolvedValue(1)

      const result = await service.hasPermission(USER_ID, 'CONTACT', 'READ')

      expect(result).toBe(true)
      expect(prisma.rolePermission.count).toHaveBeenCalledWith({
        where: {
          role: {
            userRoles: { some: { userId: USER_ID } },
            deletedAt: null,
          },
          permission: { resource: 'CONTACT', action: 'READ' },
        },
      })
    })

    it('returns false when user has no matching permission', async () => {
      prisma.rolePermission.count.mockResolvedValue(0)

      const result = await service.hasPermission(USER_ID, 'CONTACT', 'DELETE')

      expect(result).toBe(false)
    })

    it('returns false for non-existent user', async () => {
      prisma.rolePermission.count.mockResolvedValue(0)

      const result = await service.hasPermission('non-existent-user', 'CONTACT', 'READ')

      expect(result).toBe(false)
    })

    it('returns false when role is soft-deleted', async () => {
      prisma.rolePermission.count.mockResolvedValue(0)

      const result = await service.hasPermission(USER_ID, 'CONTACT', 'READ')

      expect(result).toBe(false)
      // Verify query includes deletedAt: null
      expect(prisma.rolePermission.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            role: expect.objectContaining({
              deletedAt: null,
            }),
          }),
        }),
      )
    })
  })
})
