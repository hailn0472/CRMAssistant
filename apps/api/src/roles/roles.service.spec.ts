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

  describe('removeRoleFromUser', () => {
    it('removes a role from a user', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'user-1' })
      prisma.userRole.delete.mockResolvedValue({})
      prisma.role.findUnique.mockResolvedValue({ id: ROLE_ID, name: 'Viewer' })

      const result = await service.removeRoleFromUser(TENANT_ID, ACTOR_ID, 'user-1', ROLE_ID)

      expect(result).toBe(true)
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ROLE_REMOVED',
        }),
      )
    })
  })
})
