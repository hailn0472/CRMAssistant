import { ActivityLogPreferenceService } from '../activity-log-preference.service'
import {
  ACTIVITY_LOG_PREFERENCE_KEYS,
  DEFAULT_ACTIVITY_LOG_PREFERENCES,
} from '../activity-log-preference-keys'
import type { PrismaService } from '../../prisma/prisma.service'
import type { AuditService } from '../../audit/audit.service'

type MockPrefDelegate = {
  findFirst: jest.Mock
  upsert: jest.Mock
}

type MockPrisma = {
  userActivityLogPreference: MockPrefDelegate
}

const TENANT_ID = 'tenant-1'
const USER_ID = 'user-1'

function makePrefRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'pref-1',
    tenantId: TENANT_ID,
    userId: USER_ID,
    ...DEFAULT_ACTIVITY_LOG_PREFERENCES,
    createdAt: new Date('2026-08-02T00:00:00.000Z'),
    updatedAt: new Date('2026-08-02T00:00:00.000Z'),
    createdBy: USER_ID,
    updatedBy: USER_ID,
    deletedAt: null,
    ...overrides,
  }
}

function makePrisma(): MockPrisma {
  return {
    userActivityLogPreference: {
      findFirst: jest.fn(),
      upsert: jest.fn(),
    },
  }
}

function makeAudit(): { log: jest.Mock } {
  return { log: jest.fn().mockResolvedValue(undefined) }
}

function makeService(prisma: MockPrisma, audit: { log: jest.Mock }): ActivityLogPreferenceService {
  return new ActivityLogPreferenceService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  )
}

describe('ActivityLogPreferenceService', () => {
  let prisma: MockPrisma
  let audit: { log: jest.Mock }
  let service: ActivityLogPreferenceService

  beforeEach(() => {
    prisma = makePrisma()
    audit = makeAudit()
    service = makeService(prisma, audit)
  })

  describe('isEnabled()', () => {
    it('returns true when userId is null without any DB query (AC 16 / UM13)', async () => {
      const result = await service.isEnabled(TENANT_ID, null, 'logMessageReceived')

      expect(result).toBe(true)
      expect(prisma.userActivityLogPreference.findFirst).not.toHaveBeenCalled()
    })

    it('returns true when no preference row exists (all-defaults-when-absent)', async () => {
      prisma.userActivityLogPreference.findFirst.mockResolvedValue(null)

      const result = await service.isEnabled(TENANT_ID, USER_ID, 'logTaskCompleted')

      expect(result).toBe(true)
      expect(prisma.userActivityLogPreference.findFirst).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID, userId: USER_ID, deletedAt: null },
        select: { logTaskCompleted: true },
      })
    })

    it('returns false when the preference row has that key set to false', async () => {
      prisma.userActivityLogPreference.findFirst.mockResolvedValue({
        logTaskCompleted: false,
      })

      const result = await service.isEnabled(TENANT_ID, USER_ID, 'logTaskCompleted')

      expect(result).toBe(false)
    })

    it('returns true when the preference row has that key set to true', async () => {
      prisma.userActivityLogPreference.findFirst.mockResolvedValue({
        logDealCreated: true,
      })

      const result = await service.isEnabled(TENANT_ID, USER_ID, 'logDealCreated')

      expect(result).toBe(true)
    })

    it('scopes the lookup to the caller tenant + user (tenant isolation)', async () => {
      prisma.userActivityLogPreference.findFirst.mockResolvedValue(null)

      await service.isEnabled(TENANT_ID, USER_ID, 'logMessageSent')

      expect(prisma.userActivityLogPreference.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT_ID, userId: USER_ID, deletedAt: null },
        }),
      )
    })
  })

  describe('findMine()', () => {
    it('returns all-defaults when no row exists and performs NO write (AC 16)', async () => {
      prisma.userActivityLogPreference.findFirst.mockResolvedValue(null)

      const result = await service.findMine(TENANT_ID, USER_ID)

      expect(result).toEqual(DEFAULT_ACTIVITY_LOG_PREFERENCES)
      expect(prisma.userActivityLogPreference.upsert).not.toHaveBeenCalled()
    })

    it('returns the persisted row unmodified when it exists', async () => {
      const row = makePrefRow({ logTaskCompleted: false })
      prisma.userActivityLogPreference.findFirst.mockResolvedValue(row)

      const result = await service.findMine(TENANT_ID, USER_ID)

      expect(result).toBe(row)
    })

    it('only reads rows that are not soft-deleted', async () => {
      prisma.userActivityLogPreference.findFirst.mockResolvedValue(null)

      await service.findMine(TENANT_ID, USER_ID)

      expect(prisma.userActivityLogPreference.findFirst).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID, userId: USER_ID, deletedAt: null },
      })
    })
  })

  describe('updateMine()', () => {
    it('upserts on the tenantId_userId compound unique', async () => {
      prisma.userActivityLogPreference.upsert.mockResolvedValue(makePrefRow())

      await service.updateMine(TENANT_ID, USER_ID, { logTaskCompleted: false })

      expect(prisma.userActivityLogPreference.upsert).toHaveBeenCalledWith({
        where: { tenantId_userId: { tenantId: TENANT_ID, userId: USER_ID } },
        create: expect.objectContaining({
          tenantId: TENANT_ID,
          userId: USER_ID,
          ...DEFAULT_ACTIVITY_LOG_PREFERENCES,
          logTaskCompleted: false,
          createdBy: USER_ID,
          updatedBy: USER_ID,
        }),
        update: expect.objectContaining({
          logTaskCompleted: false,
          updatedBy: USER_ID,
          deletedAt: null,
        }),
      })
    })

    it('sets deletedAt: null in the update branch so an upsert revives a soft-deleted row (AC 16 / finding 3.7-F2)', async () => {
      prisma.userActivityLogPreference.upsert.mockResolvedValue(makePrefRow())

      await service.updateMine(TENANT_ID, USER_ID, { logMessageReceived: false })

      const upsertCall = prisma.userActivityLogPreference.upsert.mock.calls[0]![0] as {
        update: { deletedAt: unknown }
      }
      expect(upsertCall.update.deletedAt).toBeNull()
    })

    it('leaves unspecified keys at their defaults on create', async () => {
      prisma.userActivityLogPreference.upsert.mockResolvedValue(makePrefRow())

      await service.updateMine(TENANT_ID, USER_ID, { logTaskCompleted: false })

      const upsertCall = prisma.userActivityLogPreference.upsert.mock.calls[0]![0] as {
        create: Record<string, unknown>
      }
      const unspecifiedKeys = ACTIVITY_LOG_PREFERENCE_KEYS.filter(
        (key) => key !== 'logTaskCompleted',
      )
      for (const key of unspecifiedKeys) {
        expect(upsertCall.create[key]).toBe(DEFAULT_ACTIVITY_LOG_PREFERENCES[key])
      }
      expect(upsertCall.create['logTaskCompleted']).toBe(false)
    })

    it('returns the upserted row unmodified', async () => {
      const row = makePrefRow({ logTaskCompleted: false })
      prisma.userActivityLogPreference.upsert.mockResolvedValue(row)

      const result = await service.updateMine(TENANT_ID, USER_ID, { logTaskCompleted: false })

      expect(result).toBe(row)
    })

    it('writes an audit row for the preference update (AC 41)', async () => {
      prisma.userActivityLogPreference.upsert.mockResolvedValue(makePrefRow())

      await service.updateMine(TENANT_ID, USER_ID, { logDealStageChanged: false })

      expect(audit.log).toHaveBeenCalledWith({
        tenantId: TENANT_ID,
        userId: USER_ID,
        action: 'UPDATE',
        entity: 'USER',
        entityId: USER_ID,
        details: expect.objectContaining({ mutationName: 'UPDATE_ACTIVITY_LOG_PREFERENCES' }),
      })
    })
  })

  describe('ActivityLogPreferenceKey vocabulary (AC 17)', () => {
    it('exactly matches the five UserActivityLogPreference boolean columns', () => {
      expect(ACTIVITY_LOG_PREFERENCE_KEYS).toEqual([
        'logTaskCompleted',
        'logDealCreated',
        'logDealStageChanged',
        'logMessageSent',
        'logMessageReceived',
      ])
    })

    it('every key has a true default', () => {
      for (const key of ACTIVITY_LOG_PREFERENCE_KEYS) {
        expect(DEFAULT_ACTIVITY_LOG_PREFERENCES[key]).toBe(true)
      }
    })
  })
})
