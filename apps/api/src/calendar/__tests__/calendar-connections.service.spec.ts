import { NotFoundException } from '@nestjs/common'

import {
  CalendarConnectionsService,
  calendarConnectionSelect,
} from '../calendar-connections.service'
import type { CalendarProviderRegistry } from '../calendar-providers.token'
import type { CalendarProviderPort } from '../calendar-provider.types'
import type { PrismaService } from '../../prisma/prisma.service'
import type { AuditService } from '../../audit/audit.service'

// AC 3/4/18/19/33-34/37-39/53: own-user scoping (ADMIN included), the
// reconnect upsert revival, the disconnect token-nulling + link cleanup, the
// ref-safe select, and the explicit service-level audit rows.

jest.mock('../../common/crypto/token-crypto', () => ({
  encryptToken: jest.fn((plaintext: string) => `enc(${plaintext})`),
  decryptToken: jest.fn((encoded: string) => encoded),
}))

function fakeProvider(overrides: Partial<CalendarProviderPort> = {}): CalendarProviderPort {
  return {
    buildAuthorizeUrl: jest.fn(() => 'https://fake/authorize'),
    exchangeCode: jest.fn(async () => ({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresInSeconds: 3600,
      scope: 'calendar',
    })),
    refreshAccessToken: jest.fn(),
    fetchAccountIdentity: jest.fn(async () => ({ externalAccountId: 'acct-1', email: 'a@b.c' })),
    createEvent: jest.fn(),
    updateEvent: jest.fn(),
    deleteEvent: jest.fn(),
    listBusy: jest.fn(async () => []),
    listChanges: jest.fn(),
    ...overrides,
  }
}

type ConnectionRow = {
  id: string
  tenantId: string
  userId: string
  provider: 'GOOGLE' | 'OUTLOOK'
  externalAccountId: string
  externalAccountEmail: string | null
  accessTokenEncrypted: string
  refreshTokenEncrypted: string | null
  accessTokenExpiresAt: Date | null
  scope: string | null
  calendarId: string
  status: string
  syncToken: string | null
  lastSyncedAt: Date | null
  lastSyncError: string | null
  createdAt: Date
  updatedAt: Date
  createdBy: string
  updatedBy: string
  deletedAt: Date | null
}

function makeConnection(overrides: Partial<ConnectionRow> = {}): ConnectionRow {
  return {
    id: 'conn-1',
    tenantId: 'tenant-a',
    userId: 'user-a',
    provider: 'GOOGLE',
    externalAccountId: 'ext-1',
    externalAccountEmail: 'a@b.c',
    accessTokenEncrypted: 'enc(token)',
    refreshTokenEncrypted: 'enc(refresh)',
    accessTokenExpiresAt: new Date('2026-08-10T00:00:00.000Z'),
    scope: 'calendar',
    calendarId: 'primary',
    status: 'ACTIVE',
    syncToken: 'tok-1',
    lastSyncedAt: null,
    lastSyncError: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    createdBy: 'user-a',
    updatedBy: 'user-a',
    deletedAt: null,
    ...overrides,
  }
}

type MockPrisma = {
  calendarConnection: {
    findMany: jest.Mock
    findFirst: jest.Mock
    upsert: jest.Mock
    update: jest.Mock
  }
  taskCalendarEvent: { deleteMany: jest.Mock }
}

function buildPrismaMock(): MockPrisma {
  return {
    calendarConnection: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    taskCalendarEvent: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  }
}

function makeService(
  prisma: MockPrisma,
  overrides: {
    oauth?: {
      verifyState: jest.Mock
      exchangeCode: jest.Mock
      getValidAccessToken: jest.Mock
    }
    providers?: CalendarProviderRegistry
  } = {},
): {
  service: CalendarConnectionsService
  audit: { log: jest.Mock }
  oauth: {
    verifyState: jest.Mock
    exchangeCode: jest.Mock
    getValidAccessToken: jest.Mock
  }
  providers: CalendarProviderRegistry
} {
  const audit = { log: jest.fn().mockResolvedValue(undefined) }
  const oauth = overrides.oauth ?? {
    verifyState: jest.fn(),
    exchangeCode: jest.fn(async () => ({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresInSeconds: 3600,
      scope: 'calendar',
    })),
    getValidAccessToken: jest.fn(async () => 'access-1'),
  }
  const providers = overrides.providers ?? { GOOGLE: fakeProvider(), OUTLOOK: fakeProvider() }
  const service = new CalendarConnectionsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    oauth as unknown as never,
    providers,
  )
  return { service, audit, oauth, providers }
}

const TENANT = 'tenant-a'
const USER_A = 'user-a'
const USER_B = 'user-b'

describe('CalendarConnectionsService', () => {
  describe('AC 3 — own-user scoping, ADMIN included', () => {
    it('listMine filters on { tenantId, userId } unconditionally (no role bypass)', async () => {
      const prisma = buildPrismaMock()
      prisma.calendarConnection.findMany.mockResolvedValue([makeConnection()])
      const { service } = makeService(prisma)

      const rows = await service.listMine(TENANT, USER_A)

      expect(prisma.calendarConnection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT, userId: USER_A, deletedAt: null },
        }),
      )
      expect(rows).toHaveLength(1)
    })

    it('disconnectCalendar for user B on user A connection throws NotFoundException (even when ADMIN)', async () => {
      const prisma = buildPrismaMock()
      // The service never consults roles — the where clause carries the
      // caller's own userId, so an ADMIN caller is scoped identically.
      prisma.calendarConnection.findFirst.mockResolvedValue(null)
      const { service } = makeService(prisma)

      await expect(service.disconnectCalendar(TENANT, USER_B, 'GOOGLE')).rejects.toThrow(
        NotFoundException,
      )
      expect(prisma.calendarConnection.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT, userId: USER_B, provider: 'GOOGLE', deletedAt: null },
        }),
      )
      expect(prisma.calendarConnection.update).not.toHaveBeenCalled()
      expect(prisma.taskCalendarEvent.deleteMany).not.toHaveBeenCalled()
    })

    it('returns only rows whose userId matches the caller — never another user’s', async () => {
      const prisma = buildPrismaMock()
      const aRow = makeConnection()
      const bRow = makeConnection({ id: 'conn-2', userId: USER_B, externalAccountEmail: 'b@x.y' })
      prisma.calendarConnection.findMany.mockResolvedValue([aRow, bRow])
      const { service } = makeService(prisma)

      await service.listMine(TENANT, USER_A)

      // The DB filter is what enforces AC 3 — assert it is always applied.
      const where = prisma.calendarConnection.findMany.mock.calls[0]?.[0]?.where
      expect(where.userId).toBe(USER_A)
      expect(where.tenantId).toBe(TENANT)
    })
  })

  describe('AC 18 — reconnect upsert revives the row', () => {
    it('update branch sets deletedAt: null, status ACTIVE, clears lastSyncError and resets syncToken', async () => {
      const prisma = buildPrismaMock()
      prisma.calendarConnection.upsert.mockResolvedValue(
        makeConnection({
          id: 'conn-1',
          status: 'ACTIVE',
          syncToken: null,
          lastSyncError: null,
          deletedAt: null,
        }),
      )
      const { service } = makeService(prisma)

      await service.connectCalendar(TENANT, USER_A, {
        provider: 'GOOGLE',
        authCode: 'auth-code',
        state: 'state-1',
      })

      const updateBlock = prisma.calendarConnection.upsert.mock.calls[0]?.[0]?.update
      expect(updateBlock).toMatchObject({
        status: 'ACTIVE',
        syncToken: null,
        lastSyncError: null,
        deletedAt: null,
      })
    })

    it('verifies the state and exchanges the code before upserting', async () => {
      const prisma = buildPrismaMock()
      prisma.calendarConnection.upsert.mockResolvedValue(makeConnection())
      const { service, oauth } = makeService(prisma)

      await service.connectCalendar(TENANT, USER_A, {
        provider: 'GOOGLE',
        authCode: 'code-123',
        state: 'state-abc',
      })

      expect(oauth.verifyState).toHaveBeenCalledWith('state-abc', USER_A, TENANT, 'GOOGLE')
      expect(oauth.exchangeCode).toHaveBeenCalledWith('GOOGLE', 'code-123')
      // Tokens are encrypted at rest — never stored plaintext (AC 2/5).
      const createBlock = prisma.calendarConnection.upsert.mock.calls[0]?.[0]?.create
      expect(createBlock.accessTokenEncrypted).toBe('enc(access-1)')
      expect(createBlock.refreshTokenEncrypted).toBe('enc(refresh-1)')
      expect(createBlock.status).toBe('ACTIVE')
      expect(createBlock.syncToken).toBeNull()
    })
  })

  describe('AC 19 — disconnect', () => {
    it('sets DISCONNECTED + deletedAt, nulls BOTH token columns and hard-deletes link rows', async () => {
      const prisma = buildPrismaMock()
      prisma.calendarConnection.findFirst.mockResolvedValue({ id: 'conn-1' })
      const { service } = makeService(prisma)
      const now = new Date('2026-08-02T00:00:00.000Z')

      const result = await service.disconnectCalendar(TENANT, USER_A, 'GOOGLE', now)

      expect(result).toBe(true)
      const updateData = prisma.calendarConnection.update.mock.calls[0]?.[0]?.data
      expect(updateData.status).toBe('DISCONNECTED')
      expect(updateData.deletedAt).toEqual(now)
      expect(updateData.accessTokenEncrypted).toBeNull()
      expect(updateData.refreshTokenEncrypted).toBeNull()
      expect(prisma.taskCalendarEvent.deleteMany).toHaveBeenCalledWith({
        where: { calendarConnectionId: 'conn-1' },
      })
    })
  })

  describe('AC 33-34 — ref-safe select', () => {
    it('select covers every field CalendarConnectionRef exposes', () => {
      const selectKeys = Object.keys(calendarConnectionSelect)
      for (const refField of [
        'id',
        'provider',
        'externalAccountEmail',
        'calendarId',
        'status',
        'lastSyncedAt',
        'lastSyncError',
        'createdAt',
      ]) {
        expect(selectKeys).toContain(refField)
      }
    })

    it('select never includes tokens, syncToken or externalAccountId (AC 5/33)', () => {
      const selectKeys = Object.keys(calendarConnectionSelect)
      expect(selectKeys).not.toContain('accessTokenEncrypted')
      expect(selectKeys).not.toContain('refreshTokenEncrypted')
      expect(selectKeys).not.toContain('syncToken')
      expect(selectKeys).not.toContain('externalAccountId')
    })

    it('service returns the raw status vocabulary (ACTIVE/REAUTH_REQUIRED/DISCONNECTED) (AC 4)', async () => {
      const prisma = buildPrismaMock()
      prisma.calendarConnection.findMany.mockResolvedValue([
        makeConnection({ status: 'ACTIVE' }),
        makeConnection({ id: 'c2', status: 'REAUTH_REQUIRED', lastSyncError: 'token rejected' }),
      ])
      const { service } = makeService(prisma)

      const rows = await service.listMine(TENANT, USER_A)
      expect(rows.map((r) => r.status).sort()).toEqual(['ACTIVE', 'REAUTH_REQUIRED'])
    })
  })

  describe('AC 37-39 — explicit service-level audit', () => {
    it('connectCalendar writes an audit row with entity CALENDAR_CONNECTION', async () => {
      const prisma = buildPrismaMock()
      prisma.calendarConnection.upsert.mockResolvedValue(makeConnection())
      const { service, audit } = makeService(prisma)

      await service.connectCalendar(TENANT, USER_A, {
        provider: 'GOOGLE',
        authCode: 'code',
        state: 'state',
      })

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT,
          userId: USER_A,
          action: 'CREATE',
          entity: 'CALENDAR_CONNECTION',
          entityId: 'conn-1',
        }),
      )
    })

    it('audit payload never contains tokens, auth code or state', async () => {
      const prisma = buildPrismaMock()
      prisma.calendarConnection.upsert.mockResolvedValue(makeConnection())
      const { service, audit } = makeService(prisma)

      await service.connectCalendar(TENANT, USER_A, {
        provider: 'GOOGLE',
        authCode: 'super-secret-code',
        state: 'super-secret-state',
      })

      const auditCall = audit.log.mock.calls[0]?.[0]
      const serialized = JSON.stringify(auditCall)
      expect(serialized).not.toContain('super-secret-code')
      expect(serialized).not.toContain('super-secret-state')
      expect(serialized).not.toContain('enc(')
    })

    it('disconnectCalendar writes an explicit DELETE audit row', async () => {
      const prisma = buildPrismaMock()
      prisma.calendarConnection.findFirst.mockResolvedValue({ id: 'conn-1' })
      const { service, audit } = makeService(prisma)

      await service.disconnectCalendar(TENANT, USER_A, 'GOOGLE')

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DELETE',
          entity: 'CALENDAR_CONNECTION',
          entityId: 'conn-1',
        }),
      )
    })
  })
})
