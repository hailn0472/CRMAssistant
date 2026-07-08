import { ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'

import { SharingService } from '../sharing.service'

type MockSharingRuleDelegate = {
  create: jest.Mock
  findFirst: jest.Mock
  findMany: jest.Mock
  update: jest.Mock
}

type MockUserRoleDelegate = {
  findMany: jest.Mock
}

type MockUserDelegate = {
  findUnique: jest.Mock
  findFirst: jest.Mock
}

type MockContactDelegate = {
  findFirst: jest.Mock
}

type MockTeamDelegate = {
  findFirst: jest.Mock
}

type MockAuditService = {
  log: jest.Mock
}

type MockPrisma = {
  sharingRule: MockSharingRuleDelegate
  userRole: MockUserRoleDelegate
  user: MockUserDelegate
  contact: MockContactDelegate
  team: MockTeamDelegate
}

const TENANT_ID = 'tenant-1'
const USER_ID = 'user-1'
const SHARING_RULE_ID = 'rule-1'
const CONTACT_ID = 'contact-1'

function makeSharingRule(overrides = {}): Record<string, unknown> {
  return {
    id: SHARING_RULE_ID,
    tenantId: TENANT_ID,
    resourceType: 'CONTACT',
    resourceId: CONTACT_ID,
    sharedWithUserId: 'user-2',
    sharedWithTeamId: null,
    accessLevel: 'READ',
    sharedBy: USER_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  }
}

function makePrisma(): MockPrisma {
  return {
    sharingRule: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    userRole: {
      findMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    contact: {
      findFirst: jest.fn(),
    },
    team: {
      findFirst: jest.fn(),
    },
  }
}

function makeAudit(): MockAuditService {
  return { log: jest.fn() }
}

describe('SharingService', () => {
  let service: SharingService
  let prisma: MockPrisma
  let audit: MockAuditService

  beforeEach(() => {
    prisma = makePrisma()
    audit = makeAudit()
    service = new SharingService(
      prisma as unknown as ConstructorParameters<typeof SharingService>[0],
      audit as unknown as ConstructorParameters<typeof SharingService>[1],
    )
  })

  describe('create()', () => {
    it('creates a sharing rule and audit logs', async () => {
      const rule = makeSharingRule()
      prisma.userRole.findMany.mockResolvedValue([]) // not ADMIN
      prisma.contact.findFirst.mockResolvedValue({ ownerId: USER_ID })
      prisma.user.findFirst.mockResolvedValue({ id: 'user-2', tenantId: TENANT_ID })
      prisma.sharingRule.create.mockResolvedValue(rule)

      const result = await service.create(TENANT_ID, USER_ID, {
        resourceType: 'CONTACT',
        resourceId: CONTACT_ID,
        sharedWithUserId: 'user-2',
        accessLevel: 'READ',
      })

      expect(result.id).toBe(SHARING_RULE_ID)
      expect(prisma.sharingRule.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: TENANT_ID,
            resourceType: 'CONTACT',
            resourceId: CONTACT_ID,
            sharedWithUserId: 'user-2',
            accessLevel: 'READ',
          }),
        }),
      )
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'SHARE_CREATED' }))
    })

    it('throws BadRequestException when neither user nor team specified', async () => {
      await expect(
        service.create(TENANT_ID, USER_ID, {
          resourceType: 'CONTACT',
          resourceId: CONTACT_ID,
          accessLevel: 'READ',
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('throws BadRequestException when both user and team specified', async () => {
      await expect(
        service.create(TENANT_ID, USER_ID, {
          resourceType: 'CONTACT',
          resourceId: CONTACT_ID,
          sharedWithUserId: 'user-2',
          sharedWithTeamId: 'team-1',
          accessLevel: 'READ',
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('throws ForbiddenException when non-owner tries to share', async () => {
      prisma.userRole.findMany.mockResolvedValue([]) // not ADMIN
      prisma.contact.findFirst.mockResolvedValue({ ownerId: 'owner-other' })

      await expect(
        service.create(TENANT_ID, USER_ID, {
          resourceType: 'CONTACT',
          resourceId: CONTACT_ID,
          sharedWithUserId: 'user-2',
          accessLevel: 'READ',
        }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('allows ADMIN to share any record', async () => {
      const rule = makeSharingRule()
      prisma.userRole.findMany.mockResolvedValue([{ role: { name: 'ADMIN' } }])
      prisma.user.findFirst.mockResolvedValue({ id: 'user-2', tenantId: TENANT_ID })
      prisma.sharingRule.create.mockResolvedValue(rule)

      const result = await service.create(TENANT_ID, USER_ID, {
        resourceType: 'CONTACT',
        resourceId: CONTACT_ID,
        sharedWithUserId: 'user-2',
        accessLevel: 'READ',
      })
      expect(result.id).toBe(SHARING_RULE_ID)
    })

    it('rejects share with team', async () => {
      const rule = makeSharingRule({ sharedWithUserId: null, sharedWithTeamId: 'team-1' })
      prisma.userRole.findMany.mockResolvedValue([])
      prisma.contact.findFirst.mockResolvedValue({ ownerId: USER_ID })
      prisma.team.findFirst.mockResolvedValue({ id: 'team-1', tenantId: TENANT_ID })
      prisma.sharingRule.create.mockResolvedValue(rule)

      const result = await service.create(TENANT_ID, USER_ID, {
        resourceType: 'CONTACT',
        resourceId: CONTACT_ID,
        sharedWithTeamId: 'team-1',
        accessLevel: 'EDIT',
      })

      expect(result.sharedWithTeamId).toBe('team-1')
      expect(result.sharedWithUserId).toBeNull()
    })

    it('throws ConflictException on duplicate sharing rule', async () => {
      prisma.userRole.findMany.mockResolvedValue([])
      prisma.contact.findFirst.mockResolvedValue({ ownerId: USER_ID })
      prisma.user.findFirst.mockResolvedValue({ id: 'user-2', tenantId: TENANT_ID })
      prisma.sharingRule.create.mockRejectedValue(
        new PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: '5',
        }),
      )

      await expect(
        service.create(TENANT_ID, USER_ID, {
          resourceType: 'CONTACT',
          resourceId: CONTACT_ID,
          sharedWithUserId: 'user-2',
          accessLevel: 'READ',
        }),
      ).rejects.toThrow('already exists')
    })
  })

  describe('unshare()', () => {
    it('soft-deletes a sharing rule', async () => {
      const rule = makeSharingRule()
      prisma.sharingRule.findFirst.mockResolvedValue(rule)
      prisma.userRole.findMany.mockResolvedValue([{ role: { name: 'ADMIN' } }])
      prisma.sharingRule.update.mockResolvedValue({ ...rule, deletedAt: new Date() })

      const result = await service.unshare(TENANT_ID, USER_ID, SHARING_RULE_ID)
      expect(result).toBe(true)
      expect(prisma.sharingRule.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: SHARING_RULE_ID },
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      )
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'SHARE_REVOKED' }))
    })

    it('throws NotFoundException when rule not found', async () => {
      prisma.sharingRule.findFirst.mockResolvedValue(null)
      await expect(service.unshare(TENANT_ID, USER_ID, 'invalid')).rejects.toThrow(
        NotFoundException,
      )
    })

    it('allows ADMIN to unshare any rule', async () => {
      const rule = makeSharingRule({ sharedBy: 'other-user' })
      prisma.sharingRule.findFirst.mockResolvedValue(rule)
      prisma.userRole.findMany.mockResolvedValue([{ role: { name: 'ADMIN' } }])
      prisma.sharingRule.update.mockResolvedValue({ ...rule, deletedAt: new Date() })

      const result = await service.unshare(TENANT_ID, USER_ID, SHARING_RULE_ID)
      expect(result).toBe(true)
    })

    it('allows rule creator (sharedBy) to unshare', async () => {
      const rule = makeSharingRule({ sharedBy: USER_ID })
      prisma.sharingRule.findFirst.mockResolvedValue(rule)
      prisma.userRole.findMany.mockResolvedValue([]) // not ADMIN
      prisma.sharingRule.update.mockResolvedValue({ ...rule, deletedAt: new Date() })

      const result = await service.unshare(TENANT_ID, USER_ID, SHARING_RULE_ID)
      expect(result).toBe(true)
    })

    it('allows record owner to unshare', async () => {
      const rule = makeSharingRule({ sharedBy: 'other-user' })
      prisma.sharingRule.findFirst.mockResolvedValue(rule)
      prisma.userRole.findMany.mockResolvedValue([]) // not ADMIN
      prisma.contact.findFirst.mockResolvedValue({ ownerId: USER_ID })
      prisma.sharingRule.update.mockResolvedValue({ ...rule, deletedAt: new Date() })

      const result = await service.unshare(TENANT_ID, USER_ID, SHARING_RULE_ID)
      expect(result).toBe(true)
    })
  })

  describe('updateAccess()', () => {
    it('updates access level', async () => {
      const rule = makeSharingRule()
      const updated = makeSharingRule({ accessLevel: 'EDIT' })
      prisma.sharingRule.findFirst.mockResolvedValue(rule)
      prisma.userRole.findMany.mockResolvedValue([{ role: { name: 'ADMIN' } }])
      prisma.sharingRule.update.mockResolvedValue(updated)

      const result = await service.updateAccess(TENANT_ID, USER_ID, SHARING_RULE_ID, {
        accessLevel: 'EDIT',
      })

      expect(result.accessLevel).toBe('EDIT')
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'SHARE_UPDATED' }))
    })

    it('throws NotFoundException when rule not found', async () => {
      prisma.sharingRule.findFirst.mockResolvedValue(null)
      await expect(
        service.updateAccess(TENANT_ID, USER_ID, 'invalid', { accessLevel: 'EDIT' }),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('getSharingRules()', () => {
    it('returns sharing rules for a record', async () => {
      const rules = [makeSharingRule()]
      prisma.userRole.findMany.mockResolvedValue([])
      prisma.contact.findFirst.mockResolvedValue({ ownerId: USER_ID })
      prisma.sharingRule.findMany.mockResolvedValue(rules)

      const result = await service.getSharingRules(TENANT_ID, USER_ID, 'CONTACT', CONTACT_ID)
      expect(result).toHaveLength(1)
      expect(result[0]!.id).toBe(SHARING_RULE_ID)
    })

    it('throws when non-owner tries to view rules', async () => {
      prisma.userRole.findMany.mockResolvedValue([])
      prisma.contact.findFirst.mockResolvedValue({ ownerId: 'owner-other' })

      await expect(
        service.getSharingRules(TENANT_ID, USER_ID, 'CONTACT', CONTACT_ID),
      ).rejects.toThrow()
    })
  })

  describe('getSharedWithMe()', () => {
    it('returns rules shared with user directly', async () => {
      const rules = [makeSharingRule()]
      prisma.user.findUnique.mockResolvedValue({ id: USER_ID, teamId: null, tenantId: TENANT_ID })
      prisma.sharingRule.findMany.mockResolvedValue(rules)

      const result = await service.getSharedWithMe(TENANT_ID, USER_ID)
      expect(result).toHaveLength(1)
    })

    it('filters by resource type when specified', async () => {
      const rules = [makeSharingRule()]
      prisma.user.findUnique.mockResolvedValue({ id: USER_ID, teamId: null, tenantId: TENANT_ID })
      prisma.sharingRule.findMany.mockResolvedValue(rules)

      const result = await service.getSharedWithMe(TENANT_ID, USER_ID, 'CONTACT')
      expect(result).toHaveLength(1)
      expect(prisma.sharingRule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ resourceType: 'CONTACT' }),
        }),
      )
    })

    it('returns team-shared rules when user belongs to a team', async () => {
      const rules = [makeSharingRule({ sharedWithUserId: null, sharedWithTeamId: 'team-1' })]
      prisma.user.findUnique.mockResolvedValue({
        id: USER_ID,
        teamId: 'team-1',
        tenantId: TENANT_ID,
      })
      prisma.sharingRule.findMany.mockResolvedValue(rules)

      const result = await service.getSharedWithMe(TENANT_ID, USER_ID)
      expect(result).toHaveLength(1)
      expect(prisma.sharingRule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              { sharedWithUserId: USER_ID },
              { sharedWithTeamId: 'team-1' },
            ]),
          }),
        }),
      )
    })
  })
})
