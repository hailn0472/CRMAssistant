import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'

import { TeamsService } from '../teams.service'

type MockTeamDelegate = {
  create: jest.Mock
  findFirst: jest.Mock
  findMany: jest.Mock
  update: jest.Mock
}

type MockUserDelegate = {
  findMany: jest.Mock
  updateMany: jest.Mock
}

type MockAuditService = {
  log: jest.Mock
}

type MockPrisma = {
  team: MockTeamDelegate
  user: MockUserDelegate
  $transaction: jest.Mock
}

const NOW = new Date('2026-07-06T00:00:00.000Z')
const TENANT_ID = 'tenant-1'
const USER_ID = 'user-1'
const TEAM_ID = 'team-1'

function makeTeam(overrides = {}): Record<string, unknown> {
  return {
    id: TEAM_ID,
    tenantId: TENANT_ID,
    name: 'Vietnam Sales',
    managerId: null,
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: USER_ID,
    updatedBy: USER_ID,
    deletedAt: null,
    manager: null,
    _count: { members: 0 },
    ...overrides,
  }
}

function makePrisma(): MockPrisma {
  return {
    team: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn((fn) =>
      fn({
        team: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: TEAM_ID, tenantId: TENANT_ID, deletedAt: null }),
        },
        user: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findMany: jest.fn().mockResolvedValue([]),
        },
      }),
    ),
  }
}

function makeAudit(): MockAuditService {
  return { log: jest.fn() }
}

describe('TeamsService', () => {
  let service: TeamsService
  let prisma: MockPrisma
  let audit: MockAuditService

  beforeEach(() => {
    prisma = makePrisma()
    audit = makeAudit()
    service = new TeamsService(
      prisma as unknown as ConstructorParameters<typeof TeamsService>[0],
      audit as unknown as ConstructorParameters<typeof TeamsService>[1],
    )
  })

  describe('create()', () => {
    it('creates a team scoped to tenant and audit logs', async () => {
      const team = makeTeam()
      prisma.team.create.mockResolvedValue(team)

      const result = await service.create(TENANT_ID, USER_ID, { name: ' Vietnam Sales ' })

      expect(result.name).toBe('Vietnam Sales')
      expect(prisma.team.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: TENANT_ID,
            name: 'Vietnam Sales',
            createdBy: USER_ID,
          }),
        }),
      )
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'TEAM_CREATED',
          entity: 'Team',
          entityId: TEAM_ID,
        }),
      )
    })

    it('throws ConflictException on duplicate name', async () => {
      prisma.team.create.mockRejectedValue(
        new PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: '5',
        }),
      )
      await expect(service.create(TENANT_ID, USER_ID, { name: 'Dup' })).rejects.toThrow(
        ConflictException,
      )
    })

    it('throws BadRequestException when name is empty', async () => {
      await expect(service.create(TENANT_ID, USER_ID, { name: '   ' })).rejects.toThrow(
        BadRequestException,
      )
    })

    it('throws BadRequestException when name exceeds max length', async () => {
      await expect(service.create(TENANT_ID, USER_ID, { name: 'A'.repeat(101) })).rejects.toThrow(
        BadRequestException,
      )
    })

    it('rethrows unknown create errors', async () => {
      prisma.team.create.mockRejectedValue(new Error('database unavailable'))
      await expect(service.create(TENANT_ID, USER_ID, { name: 'Valid Name' })).rejects.toThrow(
        'database unavailable',
      )
    })
  })

  describe('findMany()', () => {
    it('returns non-deleted teams with member count', async () => {
      const teams = [makeTeam({ id: 'team-1' }), makeTeam({ id: 'team-2' })]
      prisma.team.findMany.mockResolvedValue(teams)

      const result = await service.findMany(TENANT_ID)

      expect(prisma.team.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT_ID, deletedAt: null },
        }),
      )
      expect(result).toHaveLength(2)
    })

    it('excludes soft-deleted teams', async () => {
      prisma.team.findMany.mockResolvedValue([])
      const result = await service.findMany(TENANT_ID)
      expect(result).toHaveLength(0)
    })
  })

  describe('findOne()', () => {
    it('returns team with members and manager', async () => {
      const team = makeTeam({
        members: [{ id: 'user-1', firstName: 'A', lastName: 'B', email: 'a@b.com' }],
      })
      prisma.team.findFirst.mockResolvedValue(team)

      const result = await service.findOne(TENANT_ID, TEAM_ID)
      expect(result.id).toBe(TEAM_ID)
    })

    it('throws NotFoundException when team not found', async () => {
      prisma.team.findFirst.mockResolvedValue(null)
      await expect(service.findOne(TENANT_ID, 'invalid')).rejects.toThrow(NotFoundException)
    })
  })

  describe('update()', () => {
    it('updates name and managerId', async () => {
      const existing = makeTeam()
      const updated = makeTeam({ name: 'New Name', managerId: 'manager-1' })
      prisma.team.findFirst.mockResolvedValueOnce(existing)
      prisma.team.update.mockResolvedValue(updated)

      const result = await service.update(TENANT_ID, USER_ID, TEAM_ID, { name: ' New Name ' })

      expect(result.name).toBe('New Name')
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'TEAM_UPDATED' }))
    })

    it('throws NotFoundException when team is deleted', async () => {
      prisma.team.findFirst.mockResolvedValue(null)
      await expect(service.update(TENANT_ID, USER_ID, TEAM_ID, { name: 'X' })).rejects.toThrow(
        NotFoundException,
      )
    })

    it('throws ConflictException on duplicate name during update', async () => {
      prisma.team.findFirst.mockResolvedValueOnce(makeTeam())
      prisma.team.update.mockRejectedValue(
        new PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: '5',
        }),
      )
      await expect(service.update(TENANT_ID, USER_ID, TEAM_ID, { name: 'Dup' })).rejects.toThrow(
        ConflictException,
      )
    })

    it('rethrows unknown update errors', async () => {
      prisma.team.findFirst.mockResolvedValueOnce(makeTeam())
      prisma.team.update.mockRejectedValue(new Error('database unavailable'))
      await expect(service.update(TENANT_ID, USER_ID, TEAM_ID, { name: 'X' })).rejects.toThrow(
        'database unavailable',
      )
    })
  })

  describe('delete()', () => {
    it('soft-deletes team with no members', async () => {
      const team = makeTeam({ _count: { members: 0 } })
      prisma.team.findFirst.mockResolvedValue(team)
      prisma.team.update.mockResolvedValue(team)

      const result = await service.delete(TENANT_ID, USER_ID, TEAM_ID)
      expect(result).toBe(true)
      expect(prisma.team.update).toHaveBeenCalled()
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'TEAM_DELETED' }))
    })

    it('throws ConflictException when team has active members', async () => {
      const team = makeTeam({ _count: { members: 3 } })
      prisma.team.findFirst.mockResolvedValue(team)

      await expect(service.delete(TENANT_ID, USER_ID, TEAM_ID)).rejects.toThrow(ConflictException)
    })

    it('throws NotFoundException when team not found', async () => {
      prisma.team.findFirst.mockResolvedValue(null)
      await expect(service.delete(TENANT_ID, USER_ID, 'invalid')).rejects.toThrow(NotFoundException)
    })
  })

  describe('setTeamMembers()', () => {
    it('assigns members and removes previous', async () => {
      const team = makeTeam({
        members: [{ id: 'user-2', firstName: 'B', lastName: 'L', email: 'b@test.com' }],
      })
      prisma.team.findFirst.mockResolvedValueOnce(team) // validation
      prisma.user.findMany.mockResolvedValue([{ id: 'user-2' }, { id: 'user-3' }])
      prisma.team.findFirst.mockResolvedValueOnce({
        ...team,
        members: [
          { id: 'user-2', firstName: 'B', lastName: 'L', email: 'b@test.com' },
          { id: 'user-3', firstName: 'C', lastName: 'D', email: 'c@test.com' },
        ],
      }) // return after set

      const result = await service.setTeamMembers(TENANT_ID, USER_ID, TEAM_ID, ['user-2', 'user-3'])

      expect(result.members).toHaveLength(2)
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'TEAM_MEMBERS_SET' }),
      )
    })

    it('throws BadRequestException for invalid user IDs', async () => {
      const team = makeTeam({ members: [] })
      prisma.team.findFirst.mockResolvedValueOnce(team)
      prisma.user.findMany.mockResolvedValue([{ id: 'user-2' }])

      await expect(
        service.setTeamMembers(TENANT_ID, USER_ID, TEAM_ID, ['user-2', 'user-invalid']),
      ).rejects.toThrow(BadRequestException)
    })

    it('throws NotFoundException when team not found', async () => {
      prisma.team.findFirst.mockResolvedValue(null)
      await expect(service.setTeamMembers(TENANT_ID, USER_ID, 'invalid', [])).rejects.toThrow(
        NotFoundException,
      )
    })

    it('throws ConflictException when members already belong to another team', async () => {
      const team = makeTeam({ members: [] })
      prisma.team.findFirst.mockResolvedValueOnce(team)
      prisma.user.findMany.mockResolvedValue([{ id: 'user-2' }])
      const txMock = {
        team: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: TEAM_ID, tenantId: TENANT_ID, deletedAt: null }),
        },
        user: {
          findMany: jest.fn().mockResolvedValue([{ id: 'user-2', teamId: 'other-team' }]),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      }
      prisma.$transaction.mockImplementation(async (fn) => fn(txMock))
      await expect(service.setTeamMembers(TENANT_ID, USER_ID, TEAM_ID, ['user-2'])).rejects.toThrow(
        ConflictException,
      )
    })

    it('throws NotFoundException when team is deleted during transaction', async () => {
      const team = makeTeam({ members: [] })
      prisma.team.findFirst.mockResolvedValueOnce(team)
      prisma.user.findMany.mockResolvedValue([])
      const txMock = {
        team: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
        user: {
          findMany: jest.fn().mockResolvedValue([]),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      }
      prisma.$transaction.mockImplementation(async (fn) => fn(txMock))
      await expect(service.setTeamMembers(TENANT_ID, USER_ID, TEAM_ID, [])).rejects.toThrow(
        NotFoundException,
      )
    })

    it('handles setTeamMembers with empty memberIds', async () => {
      const team = makeTeam({ members: [] })
      prisma.team.findFirst.mockResolvedValueOnce(team)
      prisma.user.findMany.mockResolvedValue([])
      const txMock = {
        team: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: TEAM_ID, tenantId: TENANT_ID, deletedAt: null }),
        },
        user: {
          findMany: jest.fn().mockResolvedValue([]),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      }
      prisma.$transaction.mockImplementation(async (fn) => fn(txMock))
      prisma.team.findFirst.mockResolvedValueOnce({
        ...team,
        members: [],
      })
      const result = await service.setTeamMembers(TENANT_ID, USER_ID, TEAM_ID, [])
      expect(result.members).toHaveLength(0)
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'TEAM_MEMBERS_SET' }),
      )
    })
  })
})
