import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'

import { AuthService } from './auth.service'
import { TokenRevocationService } from './token-revocation.service'
import type { LoginDto } from './dto/login.dto'
import type { OAuthTokenDto } from './dto/oauth-token.dto'
import type { RegisterDto } from './dto/register.dto'

const mockSignUp = jest.fn()
const mockSignInWithPassword = jest.fn()
const mockGetUser = jest.fn()
const mockSignOut = jest.fn()
const mockDeleteUser = jest.fn()

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: {
      signUp: mockSignUp,
      signInWithPassword: mockSignInWithPassword,
      getUser: mockGetUser,
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
  userRole: { findMany: jest.Mock; create: jest.Mock }
  tenant: { create: jest.Mock }
  role: { findFirst: jest.Mock; create: jest.Mock }
}

function makePrisma(): MockPrisma {
  return {
    $transaction: jest.fn(),
    user: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    userRole: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    tenant: {
      create: jest.fn(),
    },
    role: {
      findFirst: jest.fn(),
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
      }
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          tenant: { create: jest.fn().mockResolvedValue({ id: FAKE_TENANT_ID }) },
          user: { create: jest.fn().mockResolvedValue(mockUser) },
          role: {
            create: jest
              .fn()
              .mockImplementation((args: { data: { name: string } }) =>
                Promise.resolve({ id: `role-uuid-${args.data.name}`, ...args.data }),
              ),
          },
          userRole: { create: jest.fn().mockResolvedValue({}) },
          permission: {
            findMany: jest.fn().mockResolvedValue([]),
          },
          rolePermission: {
            createMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
        }),
      )
      prisma.userRole.findMany.mockResolvedValue([{ role: { name: 'SALES_REP' } }])

      const result = await service.register(dto)

      expect(result.accessToken).toBe(FAKE_JWT)
      expect(result.roles).toEqual(['SALES_REP'])
      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: FAKE_USER_ID,
        userId: FAKE_USER_ID,
        tenantId: FAKE_TENANT_ID,
        roles: ['SALES_REP'],
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
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          tenant: { create: jest.fn() },
          user: { create: jest.fn() },
          role: { create: jest.fn() },
          userRole: { create: jest.fn() },
          permission: { findMany: jest.fn().mockResolvedValue([]) },
          rolePermission: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
        }),
      )
      // Override to throw for this test
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
      supabaseUserId: FAKE_SUPABASE_UID,
    }

    it('should log in a user and sign JWT with userId claim', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: { user: { id: FAKE_SUPABASE_UID } },
        error: null,
      })
      prisma.user.findFirst.mockResolvedValue(dbUser)
      prisma.userRole.findMany.mockResolvedValue([{ role: { name: 'SALES_REP' } }])

      const result = await service.login(dto)

      expect(result.accessToken).toBe(FAKE_JWT)
      expect(result.roles).toEqual(['SALES_REP'])
      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: FAKE_USER_ID,
        userId: FAKE_USER_ID,
        tenantId: FAKE_TENANT_ID,
        roles: ['SALES_REP'],
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
      prisma.userRole.findMany.mockResolvedValue([])

      const result = await service.login(dto)

      expect(result.accessToken).toBe(FAKE_JWT)
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ supabaseUserId: 'new-supabase-uid' }),
        }),
      )
    })
  })

  describe('oauthLogin()', () => {
    const dto: OAuthTokenDto = { accessToken: 'google-oauth-token' }
    const supabaseUser = {
      id: FAKE_SUPABASE_UID,
      email: FAKE_EMAIL,
      user_metadata: {
        full_name: 'Test User',
        avatar_url: 'https://example.com/avatar.jpg',
      },
    }
    const dbUser = {
      id: FAKE_USER_ID,
      tenantId: FAKE_TENANT_ID,
      email: FAKE_EMAIL,
      firstName: FAKE_FIRST_NAME,
      lastName: FAKE_LAST_NAME,
      supabaseUserId: FAKE_SUPABASE_UID,
      avatar: null,
    }

    it('should login existing user by supabaseUserId', async () => {
      mockGetUser.mockResolvedValue({ data: { user: supabaseUser }, error: null })
      prisma.user.findFirst.mockResolvedValue(dbUser)
      prisma.userRole.findMany.mockResolvedValue([{ role: { name: 'SALES_REP' } }])

      const result = await service.oauthLogin(dto)

      expect(result.accessToken).toBe(FAKE_JWT)
      expect(result.roles).toEqual(['SALES_REP'])
      expect(result.email).toBe(FAKE_EMAIL)
      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: FAKE_USER_ID,
        userId: FAKE_USER_ID,
        tenantId: FAKE_TENANT_ID,
        roles: ['SALES_REP'],
        email: FAKE_EMAIL,
      })
    })

    it('should auto-link when email fallback finds exactly 1 user', async () => {
      mockGetUser.mockResolvedValue({ data: { user: supabaseUser }, error: null })
      prisma.user.findFirst.mockResolvedValue(null)
      prisma.user.findMany.mockResolvedValue([{ ...dbUser, supabaseUserId: null }])
      prisma.user.update.mockResolvedValue({ ...dbUser, supabaseUserId: supabaseUser.id })
      prisma.userRole.findMany.mockResolvedValue([])

      const result = await service.oauthLogin(dto)

      expect(result.accessToken).toBe(FAKE_JWT)
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ supabaseUserId: FAKE_SUPABASE_UID }),
        }),
      )
    })

    it('should create tenant + user + SALES_REP role for first-time signup', async () => {
      mockGetUser.mockResolvedValue({ data: { user: supabaseUser }, error: null })
      prisma.user.findFirst.mockResolvedValue(null)
      prisma.user.findMany.mockResolvedValue([])
      const mockUser = {
        id: FAKE_USER_ID,
        tenantId: FAKE_TENANT_ID,
        email: FAKE_EMAIL,
        firstName: 'Test',
        lastName: 'User',
        avatar: 'https://example.com/avatar.jpg',
      }
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          tenant: { create: jest.fn().mockResolvedValue({ id: FAKE_TENANT_ID }) },
          user: { create: jest.fn().mockResolvedValue(mockUser) },
          role: {
            create: jest
              .fn()
              .mockImplementation((args: { data: { name: string } }) =>
                Promise.resolve({ id: `role-uuid-${args.data.name}`, ...args.data }),
              ),
          },
          userRole: { create: jest.fn().mockResolvedValue({}) },
          permission: { findMany: jest.fn().mockResolvedValue([]) },
          rolePermission: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
        }),
      )
      prisma.userRole.findMany.mockResolvedValue([{ role: { name: 'SALES_REP' } }])

      const result = await service.oauthLogin(dto)

      expect(result.accessToken).toBe(FAKE_JWT)
      expect(result.roles).toEqual(['SALES_REP'])
      expect(result.avatar).toBe('https://example.com/avatar.jpg')
    })

    it('should use tenantName from dto when provided for first-time signup', async () => {
      const dtoWithTenant: OAuthTokenDto = { accessToken: 'google-oauth-token', tenantName: 'MyCo' }
      mockGetUser.mockResolvedValue({ data: { user: supabaseUser }, error: null })
      prisma.user.findFirst.mockResolvedValue(null)
      prisma.user.findMany.mockResolvedValue([])

      let createdTenantName = ''
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          tenant: {
            create: jest.fn().mockImplementation((args: { data: { name: string } }) => {
              createdTenantName = args.data.name
              return Promise.resolve({ id: FAKE_TENANT_ID })
            }),
          },
          user: {
            create: jest.fn().mockResolvedValue({
              id: FAKE_USER_ID,
              tenantId: FAKE_TENANT_ID,
              email: FAKE_EMAIL,
              firstName: 'Test',
              lastName: 'User',
              avatar: null,
            }),
          },
          role: {
            create: jest
              .fn()
              .mockImplementation((args: { data: { name: string } }) =>
                Promise.resolve({ id: `role-uuid-${args.data.name}`, ...args.data }),
              ),
          },
          userRole: { create: jest.fn().mockResolvedValue({}) },
          permission: { findMany: jest.fn().mockResolvedValue([]) },
          rolePermission: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
        }),
      )
      prisma.userRole.findMany.mockResolvedValue([{ role: { name: 'SALES_REP' } }])

      await service.oauthLogin(dtoWithTenant)
      expect(createdTenantName).toBe('MyCo')
    })

    it('should throw UnauthorizedException for ambiguous email across tenants', async () => {
      mockGetUser.mockResolvedValue({ data: { user: supabaseUser }, error: null })
      prisma.user.findFirst.mockResolvedValue(null)
      prisma.user.findMany.mockResolvedValue([
        { ...dbUser, id: 'user-1', tenantId: 'tenant-1', supabaseUserId: null },
        { ...dbUser, id: 'user-2', tenantId: 'tenant-2', supabaseUserId: null },
      ])

      await expect(service.oauthLogin(dto)).rejects.toThrow(UnauthorizedException)
    })

    it('should throw UnauthorizedException for deactivated account', async () => {
      mockGetUser.mockResolvedValue({ data: { user: supabaseUser }, error: null })
      prisma.user.findFirst.mockResolvedValue(null)
      prisma.user.findMany.mockResolvedValue([])
      // Override findFirst: call 1 (supabaseUserId lookup) → null, call 2 (deactivated check) → deactivated user
      prisma.user.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...dbUser, isActive: false })

      await expect(service.oauthLogin(dto)).rejects.toThrow(UnauthorizedException)
    })

    it('should throw UnauthorizedException for invalid/expired token', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'Token expired' } })

      await expect(service.oauthLogin(dto)).rejects.toThrow(UnauthorizedException)
    })

    it('should timeout after 10s', async () => {
      jest.useFakeTimers()
      mockGetUser.mockReturnValue(new Promise(() => undefined))

      const oauthLogin = expect(service.oauthLogin(dto)).rejects.toThrow(BadRequestException)
      await jest.advanceTimersByTimeAsync(10_000)

      await oauthLogin
      jest.useRealTimers()
    })

    it('should return JWT payload matching existing shape', async () => {
      mockGetUser.mockResolvedValue({ data: { user: supabaseUser }, error: null })
      prisma.user.findFirst.mockResolvedValue(dbUser)
      prisma.userRole.findMany.mockResolvedValue([{ role: { name: 'SALES_REP' } }])

      const result = await service.oauthLogin(dto)

      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: FAKE_USER_ID,
        userId: FAKE_USER_ID,
        tenantId: FAKE_TENANT_ID,
        roles: ['SALES_REP'],
        email: FAKE_EMAIL,
      })
      expect(result).toHaveProperty('accessToken')
      expect(result).toHaveProperty('userId')
      expect(result).toHaveProperty('tenantId')
      expect(result).toHaveProperty('roles')
      expect(result).toHaveProperty('email')
      expect(result).toHaveProperty('firstName')
      expect(result).toHaveProperty('lastName')
    })

    it('should throw UnauthorizedException when Google account has no email', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: { ...supabaseUser, email: undefined } },
        error: null,
      })

      await expect(service.oauthLogin(dto)).rejects.toThrow(UnauthorizedException)
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
