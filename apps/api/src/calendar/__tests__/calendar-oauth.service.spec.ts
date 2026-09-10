import { BadRequestException } from '@nestjs/common'

import { CalendarOAuthService } from '../calendar-oauth.service'
import { GoogleCalendarClient } from '../google-calendar.client'
import { OutlookCalendarClient } from '../outlook-calendar.client'
import { CalendarApiError, CalendarHttp } from '../calendar-http'
import type { CalendarProviderRegistry } from '../calendar-providers.token'
import type { CalendarProviderPort } from '../calendar-provider.types'
import type { PrismaService } from '../../prisma/prisma.service'

// AC 12-17: authorize URL structure, signed-state binding, code exchange,
// proactive token refresh and REAUTH_REQUIRED on a 4xx refresh.

jest.mock('../../common/crypto/token-crypto', () => {
  const actual = jest.requireActual('../../common/crypto/token-crypto')
  return {
    ...actual,
    encryptToken: jest.fn((plaintext: string) => `enc(${plaintext})`),
    decryptToken: jest.fn((encoded: string) =>
      encoded.startsWith('enc(') ? encoded.slice(4, -1) : encoded,
    ),
  }
})

const ENCRYPTION_KEY = 'a'.repeat(64)

function fakeProvider(overrides: Partial<CalendarProviderPort> = {}): CalendarProviderPort {
  return {
    buildAuthorizeUrl: jest.fn((state: string) => `https://fake/authorize?state=${state}`),
    exchangeCode: jest.fn(async () => ({
      accessToken: 'access-token-1',
      refreshToken: 'refresh-token-1',
      expiresInSeconds: 3600,
      scope: 'calendar',
    })),
    refreshAccessToken: jest.fn(async (refreshToken: string) => ({
      accessToken: 'access-token-2',
      refreshToken,
      expiresInSeconds: 3600,
      scope: 'calendar',
    })),
    fetchAccountIdentity: jest.fn(async () => ({ externalAccountId: 'acct-1', email: 'a@b.c' })),
    createEvent: jest.fn(),
    updateEvent: jest.fn(),
    deleteEvent: jest.fn(),
    listBusy: jest.fn(async () => []),
    listChanges: jest.fn(),
    ...overrides,
  }
}

function makeService(
  overrides: {
    jwt?: { sign: jest.Mock; verify: jest.Mock }
    providers?: CalendarProviderRegistry
    prisma?: { calendarConnection: { update: jest.Mock } }
  } = {},
): {
  service: CalendarOAuthService
  jwt: { sign: jest.Mock; verify: jest.Mock }
  prisma: { calendarConnection: { update: jest.Mock } }
  providers: CalendarProviderRegistry
} {
  const jwt = overrides.jwt ?? {
    sign: jest.fn((payload: unknown) => `signed(${JSON.stringify(payload)})`),
    verify: jest.fn(() => ({
      userId: 'user-a',
      tenantId: 'tenant-a',
      provider: 'GOOGLE',
      iat: Date.now() / 1000,
    })),
  }
  const prisma = overrides.prisma ?? {
    calendarConnection: { update: jest.fn().mockResolvedValue({}) },
  }
  const providers = overrides.providers ?? {
    GOOGLE: fakeProvider(),
    OUTLOOK: fakeProvider(),
  }
  const service = new CalendarOAuthService(
    prisma as unknown as PrismaService,
    jwt as never,
    providers,
  )
  return { service, jwt, prisma, providers }
}

describe('CalendarOAuthService', () => {
  beforeEach(() => {
    process.env['ENCRYPTION_KEY'] = ENCRYPTION_KEY
  })

  afterEach(() => {
    jest.clearAllMocks()
    delete process.env['GOOGLE_CALENDAR_CLIENT_ID']
    delete process.env['GOOGLE_CALENDAR_CLIENT_SECRET']
    delete process.env['MICROSOFT_CALENDAR_CLIENT_ID']
    delete process.env['MICROSOFT_CALENDAR_CLIENT_SECRET']
    delete process.env['CALENDAR_OAUTH_REDIRECT_URI']
    delete process.env['MICROSOFT_CALENDAR_TENANT_ID']
  })

  describe('buildAuthorizeUrl', () => {
    it('signs a state carrying userId, tenantId, provider and a nonce, expiring in 10 minutes', () => {
      const { service, jwt } = makeService()
      const signMock = jwt.sign as jest.Mock

      service.buildAuthorizeUrl('GOOGLE', 'user-a', 'tenant-a')

      expect(signMock).toHaveBeenCalledTimes(1)
      const [payload, options] = signMock.mock.calls[0] as [
        Record<string, unknown>,
        Record<string, unknown>,
      ]
      expect(payload['userId']).toBe('user-a')
      expect(payload['tenantId']).toBe('tenant-a')
      expect(payload['provider']).toBe('GOOGLE')
      expect(typeof payload['nonce']).toBe('string')
      expect((payload['nonce'] as string).length).toBeGreaterThan(0)
      expect(options['expiresIn']).toBe('10m')
    })

    it('builds the Google authorize URL with access_type=offline and prompt=consent (AC 15)', () => {
      process.env['GOOGLE_CALENDAR_CLIENT_ID'] = 'gid'
      process.env['GOOGLE_CALENDAR_CLIENT_SECRET'] = 'gsecret'
      process.env['CALENDAR_OAUTH_REDIRECT_URI'] =
        'http://localhost:3000/settings/calendars/callback'
      const http = new CalendarHttp()
      const client = new GoogleCalendarClient(http)

      const url = client.buildAuthorizeUrl('state-123')

      expect(url).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/)
      expect(url).toContain('response_type=code')
      expect(url).toContain('client_id=gid')
      expect(url).toContain('access_type=offline')
      expect(url).toContain('prompt=consent')
      expect(url).toContain(encodeURIComponent('https://www.googleapis.com/auth/calendar.events'))
      expect(url).toContain('state=state-123')
    })

    it('builds the Microsoft authorize URL with offline_access scope (AC 16)', () => {
      process.env['MICROSOFT_CALENDAR_CLIENT_ID'] = 'mid'
      process.env['MICROSOFT_CALENDAR_CLIENT_SECRET'] = 'msecret'
      process.env['CALENDAR_OAUTH_REDIRECT_URI'] =
        'http://localhost:3000/settings/calendars/callback'
      const http = new CalendarHttp()
      const client = new OutlookCalendarClient(http)

      const url = client.buildAuthorizeUrl('state-456')

      expect(url).toMatch(
        /^https:\/\/login\.microsoftonline\.com\/common\/oauth2\/v2\.0\/authorize\?/,
      )
      expect(url).toContain('response_type=code')
      expect(url).toContain('client_id=mid')
      expect(url).toContain('scope=Calendars.ReadWrite+offline_access+User.Read')
      expect(url).toContain('state=state-456')
    })

    it('uses the configured MICROSOFT_CALENDAR_TENANT_ID when present', () => {
      process.env['MICROSOFT_CALENDAR_CLIENT_ID'] = 'mid'
      process.env['MICROSOFT_CALENDAR_CLIENT_SECRET'] = 'msecret'
      process.env['CALENDAR_OAUTH_REDIRECT_URI'] =
        'http://localhost:3000/settings/calendars/callback'
      process.env['MICROSOFT_CALENDAR_TENANT_ID'] = 'contoso.onmicrosoft.com'
      const http = new CalendarHttp()
      const client = new OutlookCalendarClient(http)

      const url = client.buildAuthorizeUrl('state-789')
      expect(url).toContain(
        'login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/authorize',
      )
    })
  })

  describe('missing configuration (AC 12)', () => {
    it('throws a BadRequestException naming GOOGLE_CALENDAR_CLIENT_ID when missing', () => {
      const http = new CalendarHttp()
      const client = new GoogleCalendarClient(http)
      expect(() => client.buildAuthorizeUrl('state-x')).toThrow(BadRequestException)
      expect(() => client.buildAuthorizeUrl('state-x')).toThrow('GOOGLE_CALENDAR_CLIENT_ID')
    })

    it('throws a BadRequestException naming MICROSOFT_CALENDAR_CLIENT_SECRET when missing', () => {
      process.env['MICROSOFT_CALENDAR_CLIENT_ID'] = 'mid'
      process.env['CALENDAR_OAUTH_REDIRECT_URI'] =
        'http://localhost:3000/settings/calendars/callback'
      const http = new CalendarHttp()
      const client = new OutlookCalendarClient(http)
      expect(() => client.buildAuthorizeUrl('state-x')).toThrow(BadRequestException)
      expect(() => client.buildAuthorizeUrl('state-x')).toThrow('MICROSOFT_CALENDAR_CLIENT_SECRET')
    })
  })

  describe('verifyState (AC 14)', () => {
    it('accepts a state minted for the caller', () => {
      const { service } = makeService()
      expect(() => service.verifyState('state-1', 'user-a', 'tenant-a', 'GOOGLE')).not.toThrow()
    })

    it('rejects a state minted for user A when user B calls connectCalendar', () => {
      const { service } = makeService()
      expect(() => service.verifyState('state-1', 'user-b', 'tenant-a', 'GOOGLE')).toThrow(
        BadRequestException,
      )
    })

    it('rejects a state minted for a different tenant', () => {
      const { service } = makeService()
      expect(() => service.verifyState('state-1', 'user-a', 'tenant-b', 'GOOGLE')).toThrow(
        BadRequestException,
      )
    })

    it('rejects a state minted for a different provider', () => {
      const { service } = makeService()
      expect(() => service.verifyState('state-1', 'user-a', 'tenant-a', 'OUTLOOK')).toThrow(
        BadRequestException,
      )
    })

    it('rejects a state whose JWT no longer verifies (expired/invalid signature)', () => {
      const { service } = makeService({
        jwt: {
          sign: jest.fn(() => 'signed'),
          verify: jest.fn(() => {
            throw new Error('jwt expired')
          }),
        },
      })
      expect(() => service.verifyState('state-old', 'user-a', 'tenant-a', 'GOOGLE')).toThrow(
        BadRequestException,
      )
    })

    it('rejects an expired state via the iat age check even when the JWT verifies', () => {
      const { service } = makeService({
        jwt: {
          sign: jest.fn(() => 'signed'),
          verify: jest.fn(() => ({
            userId: 'user-a',
            tenantId: 'tenant-a',
            provider: 'GOOGLE',
            iat: (Date.now() - 20 * 60 * 1000) / 1000, // 20 minutes ago > 10m TTL
          })),
        },
      })
      expect(() => service.verifyState('state-old', 'user-a', 'tenant-a', 'GOOGLE')).toThrow(
        BadRequestException,
      )
    })
  })

  describe('getValidAccessToken (AC 17)', () => {
    const baseConnection = {
      id: 'conn-1',
      userId: 'user-a',
      provider: 'GOOGLE' as const,
      accessTokenEncrypted: 'enc(valid-access-token)',
      refreshTokenEncrypted: 'enc(refresh-token-1)',
      accessTokenExpiresAt: new Date('2026-08-10T00:00:00.000Z'),
    }

    it('returns the stored token without refreshing when far from expiry', async () => {
      const { service, prisma } = makeService()
      const now = new Date('2026-08-01T00:00:00.000Z')
      const token = await service.getValidAccessToken(baseConnection, now)
      expect(token).toBe('valid-access-token')
      expect(prisma.calendarConnection.update).not.toHaveBeenCalled()
    })

    it('refreshes when the access token expires within 120 seconds of now', async () => {
      const { service, prisma, providers } = makeService()
      const now = new Date('2026-08-01T00:00:00.000Z')
      const expiring = {
        ...baseConnection,
        accessTokenExpiresAt: new Date(now.getTime() + 60 * 1000), // 60s away
      }
      const token = await service.getValidAccessToken(expiring, now)
      expect(token).toBe('access-token-2')
      expect(providers['GOOGLE'].refreshAccessToken).toHaveBeenCalledWith('refresh-token-1')
      expect(prisma.calendarConnection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ accessTokenEncrypted: 'enc(access-token-2)' }),
        }),
      )
    })

    it('refreshes when accessTokenExpiresAt is absent', async () => {
      const { service, prisma } = makeService()
      const now = new Date('2026-08-01T00:00:00.000Z')
      const token = await service.getValidAccessToken(
        { ...baseConnection, accessTokenExpiresAt: null },
        now,
      )
      expect(token).toBe('access-token-2')
      expect(prisma.calendarConnection.update).toHaveBeenCalled()
    })

    it('sets REAUTH_REQUIRED + lastSyncError on a 4xx refresh and does NOT retry', async () => {
      const refreshMock = jest.fn().mockRejectedValue(new CalendarApiError(400, 'invalid_grant'))
      const { service, prisma, providers } = makeService({
        providers: {
          GOOGLE: fakeProvider({ refreshAccessToken: refreshMock }),
          OUTLOOK: fakeProvider(),
        },
      })
      const now = new Date('2026-08-01T00:00:00.000Z')
      const expiring = { ...baseConnection, accessTokenExpiresAt: new Date(now.getTime() + 1000) }

      await expect(service.getValidAccessToken(expiring, now)).rejects.toThrow(BadRequestException)

      const update = prisma.calendarConnection.update as jest.Mock
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'REAUTH_REQUIRED',
            lastSyncError: expect.stringContaining('reconnect'),
          }),
        }),
      )
      // The refresh provider call happened exactly once — no retry of a
      // permanently-invalid grant (AC 17).
      expect(providers['GOOGLE'].refreshAccessToken).toHaveBeenCalledTimes(1)
    })

    it('rethrows a non-4xx refresh failure without marking REAUTH_REQUIRED', async () => {
      const { service, prisma } = makeService({
        providers: {
          GOOGLE: fakeProvider({
            refreshAccessToken: jest.fn().mockRejectedValue(new Error('network down')),
          }),
          OUTLOOK: fakeProvider(),
        },
      })
      const now = new Date('2026-08-01T00:00:00.000Z')
      const expiring = { ...baseConnection, accessTokenExpiresAt: new Date(now.getTime() + 1000) }

      await expect(service.getValidAccessToken(expiring, now)).rejects.toThrow('network down')
      expect(prisma.calendarConnection.update).not.toHaveBeenCalled()
    })
  })
})
