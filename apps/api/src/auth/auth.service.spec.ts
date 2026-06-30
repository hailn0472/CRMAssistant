import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'

import { AuthService } from './auth.service'
import { TokenRevocationService } from './token-revocation.service'
import type { LoginDto } from './dto/login.dto'
import type { RegisterDto } from './dto/register.dto'

const mockSignUp = jest.fn()
const mockSignInWithPassword = jest.fn()
const mockSignOut = jest.fn()
const mockDeleteUser = jest.fn()

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: {
      signUp: mockSignUp,
      signInWithPassword: mockSignInWithPassword,
      signOut: mockSignOut,
      admin: { deleteUser: mockDeleteUser },
    },
  })),
}))

const FAKE_TENANT_ID = 'tenant-uuid-0001'
const FAKE_USER_ID = 'user-uuid-0001'
const FAKE_SUPABASE_UID = 'supabase-uid-0001'
const FAKE_EMAIL = 'test@example.com'
const FAKE_FIRST_NAME = 'Test'
const FAKE_LAST_NAME = 'User'
const FAKE_JWT = 'signed.jwt.token'

type MockPrisma = {
  $transaction: jest.Mock
  user: { findFirst: jest.Mock; findMany: jest.Mock; update: jest.Mock }
  tenant: { create: jest.Mock }
}

function makePrisma(): MockPrisma {
  return {
    $transaction: jest.fn(),
    user: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    tenant: {
      create: jest.fn(),
    },
  }
}

type MockJwtService = { sign: jest.Mock; verify: jest.Mock }

function makeJwtService(): MockJwtService {
  return {
    sign: jest.fn(() => FAKE_JWT),
    verify: jest.fn(),
  }
}

type MockConfigService = { get: jest.Mock }

function makeConfigService(overrides: Record<string, string> = {}): MockConfigService {
  return {
    get: jest.fn((key: string) => {
      const defaults: Record<string, string> = {
        SUPABASE_URL: 'https://test.supabase.co',
        SUPABASE_ANON_KEY: 'test-anon-key',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
        JWT_SECRET: 'super-secret-at-least-32-chars!!',
        ...overrides,
      }
      return defaults[key]
    }),
  }
}

describe('AuthService', () => {
  let service: AuthService
  let prisma: MockPrisma
  let jwtService: MockJwtService
  let tokenRevocationService: TokenRevocationService

  beforeEach(() => {
    jest.clearAllMocks()
    prisma = makePrisma()
    jwtService = makeJwtService()
    tokenRevocationService = new TokenRevocationService()
    const configService = makeConfigService()

    service = new AuthService(
      prisma as unknown as ConstructorParameters<typeof AuthService>[0],
      jwtService as unknown as JwtService,
      configService as unknown as ConfigService,
      tokenRevocationService,
    )
  })

  describe('register()', () => {
    const dto: RegisterDto = {
      email: FAKE_EMAIL,
      password: 'Password123',
      firstName: 'Test',
      lastName: 'User',
      tenantName: 'ACME Corp',
    }

    it('should register a new user and sign JWT with userId claim', async () => {
      mockSignUp.mockResolvedValue({ data: { user: { id: FAKE_SUPABASE_UID } }, error: null })
      const mockUser = {
        id: FAKE_USER_ID,
        tenantId: FAKE_TENANT_ID,
        email: FAKE_EMAIL,
        firstName: 'Test',
        lastName: 'User',
        role: 'SALES_REP',
      }
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          tenant: { create: jest.fn().mockResolvedValue({ id: FAKE_TENANT_ID }) },
          user: { create: jest.fn().mockResolvedValue(mockUser) },
        }),
      )

      const result = await service.register(dto)

      expect(result.accessToken).toBe(FAKE_JWT)
      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: FAKE_USER_ID,
        userId: FAKE_USER_ID,
        tenantId: FAKE_TENANT_ID,
        role: 'SALES_REP',
        email: FAKE_EMAIL,
      })
    })

    it('should throw BadRequestException when tenantName is blank after trim', async () => {
      await expect(service.register({ ...dto, tenantName: '  ' })).rejects.toThrow(
        BadRequestException,
      )
    })

    it('should throw ConflictException when email is already registered in Supabase', async () => {
      mockSignUp.mockResolvedValue({
        data: { user: null },
        error: { message: 'User already registered' },
      })

      await expect(service.register(dto)).rejects.toThrow(ConflictException)
    })

    it('should throw BadRequestException when Supabase returns a generic error', async () => {
      mockSignUp.mockResolvedValue({
        data: { user: null },
        error: { message: 'Something went wrong' },
      })

      await expect(service.register(dto)).rejects.toThrow(BadRequestException)
    })

    it('should fail fast when Supabase registration does not respond', async () => {
      jest.useFakeTimers()
      mockSignUp.mockReturnValue(new Promise(() => undefined))

      const registration = expect(service.register(dto)).rejects.toThrow(BadRequestException)
      await jest.advanceTimersByTimeAsync(10_000)

      await registration
      jest.useRealTimers()
    })

    it('should clean up Supabase user and throw when DB transaction fails', async () => {
      mockSignUp.mockResolvedValue({ data: { user: { id: FAKE_SUPABASE_UID } }, error: null })
      mockDeleteUser.mockResolvedValue({ error: null })
      prisma.$transaction.mockRejectedValue(new Error('database failure'))

      await expect(service.register(dto)).rejects.toThrow('Registration failed')
      expect(mockDeleteUser).toHaveBeenCalledWith(FAKE_SUPABASE_UID)
    })

    it('should throw ConflictException when DB unique constraint fails', async () => {
      mockSignUp.mockResolvedValue({ data: { user: { id: FAKE_SUPABASE_UID } }, error: null })
      mockDeleteUser.mockResolvedValue({ error: null })
      prisma.$transaction.mockRejectedValue(
        new PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.22.0',
        }),
      )

      await expect(service.register(dto)).rejects.toThrow(ConflictException)
      expect(mockDeleteUser).toHaveBeenCalledWith(FAKE_SUPABASE_UID)
    })
  })

  describe('login()', () => {
    const dto: LoginDto = { email: FAKE_EMAIL, password: 'Password123' }
    const dbUser = {
      id: FAKE_USER_ID,
      tenantId: FAKE_TENANT_ID,
      email: FAKE_EMAIL,
      firstName: FAKE_FIRST_NAME,
      lastName: FAKE_LAST_NAME,
      role: 'SALES_REP',
      supabaseUserId: FAKE_SUPABASE_UID,
    }

    it('should log in a user and sign JWT with userId claim', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: { user: { id: FAKE_SUPABASE_UID } },
        error: null,
      })
      prisma.user.findFirst.mockResolvedValue(dbUser)

      const result = await service.login(dto)

      expect(result.accessToken).toBe(FAKE_JWT)
      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: FAKE_USER_ID,
        userId: FAKE_USER_ID,
        tenantId: FAKE_TENANT_ID,
        role: 'SALES_REP',
        email: FAKE_EMAIL,
      })
    })

    it('should throw UnauthorizedException when Supabase rejects credentials', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: { user: null },
        error: { message: 'Invalid login credentials' },
      })

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException)
    })

    it('should throw UnauthorizedException when user not found in DB', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: { user: { id: FAKE_SUPABASE_UID } },
        error: null,
      })
      prisma.user.findFirst.mockResolvedValue(null)
      prisma.user.findMany.mockResolvedValue([])

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException)
    })

    it('should throw UnauthorizedException when email fallback is ambiguous across tenants', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: { user: { id: 'new-supabase-uid' } },
        error: null,
      })
      prisma.user.findFirst.mockResolvedValue(null)
      prisma.user.findMany.mockResolvedValue([
        { ...dbUser, id: 'user-1', tenantId: 'tenant-1', supabaseUserId: null },
        { ...dbUser, id: 'user-2', tenantId: 'tenant-2', supabaseUserId: null },
      ])

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException)
    })

    it('should link supabaseUserId when exactly one user is found by email', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: { user: { id: 'new-supabase-uid' } },
        error: null,
      })
      prisma.user.findFirst.mockResolvedValue(null)
      prisma.user.findMany.mockResolvedValue([{ ...dbUser, supabaseUserId: null }])
      prisma.user.update.mockResolvedValue({ ...dbUser, supabaseUserId: 'new-supabase-uid' })

      const result = await service.login(dto)

      expect(result.accessToken).toBe(FAKE_JWT)
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ supabaseUserId: 'new-supabase-uid' }),
        }),
      )
    })
  })

  describe('logout()', () => {
    it('should revoke valid JWT tokens', async () => {
      mockSignOut.mockResolvedValue({ error: null })
      jwtService.verify.mockReturnValue({ sub: FAKE_USER_ID, userId: FAKE_USER_ID })

      await expect(service.logout(FAKE_JWT)).resolves.toBeUndefined()
      expect(mockSignOut).toHaveBeenCalledTimes(1)
      expect(tokenRevocationService.isRevoked(FAKE_JWT)).toBe(true)
    })

    it('should not throw when token is already invalid', async () => {
      mockSignOut.mockResolvedValue({ error: null })
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired')
      })

      await expect(service.logout('expired.token')).resolves.toBeUndefined()
    })
  })
})
