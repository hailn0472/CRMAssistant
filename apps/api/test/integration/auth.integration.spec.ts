/**
 * Backend Integration Test: Authentication System (Story 1.7)
 */

import { execFileSync } from 'child_process'
import * as path from 'path'

import { INestApplication, ValidationPipe } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { PrismaClient } from '@prisma/client'
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import request from 'supertest'

const mockSupabaseSignUp = jest.fn()
const mockSupabaseSignIn = jest.fn()
const mockSupabaseSignOut = jest.fn()
const mockSupabaseDeleteUser = jest.fn()

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: {
      signUp: mockSupabaseSignUp,
      signInWithPassword: mockSupabaseSignIn,
      signOut: mockSupabaseSignOut,
      admin: { deleteUser: mockSupabaseDeleteUser },
    },
  })),
}))

import { AppModule } from '../../src/app.module'

const SUPABASE_UID_1 = '11111111-1111-1111-1111-111111111111'
const SUPABASE_UID_2 = '22222222-2222-2222-2222-222222222222'

function successfulSignUp(uid: string = SUPABASE_UID_1): void {
  mockSupabaseSignUp.mockResolvedValue({ data: { user: { id: uid } }, error: null })
}

function successfulSignIn(uid: string = SUPABASE_UID_1): void {
  mockSupabaseSignIn.mockResolvedValue({ data: { user: { id: uid } }, error: null })
}

describe('Authentication System (integration)', () => {
  let app: INestApplication
  let prisma: PrismaClient
  let container: StartedPostgreSqlContainer
  let jwtService: JwtService

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:15-alpine').start()
    const databaseUrl = container.getConnectionUri()
    process.env['DATABASE_URL'] = databaseUrl
    process.env['SUPABASE_URL'] = 'https://test.supabase.co'
    process.env['SUPABASE_ANON_KEY'] = 'test-anon-key'
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-role-key'
    process.env['JWT_SECRET'] = 'integration-test-secret-min-32-chars!!'
    process.env['FRONTEND_URL'] = 'http://localhost:3000'

    const prismaBin = path.resolve(__dirname, '../../node_modules/.bin/prisma')
    execFileSync(prismaBin, ['migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      cwd: path.resolve(__dirname, '../..'),
      stdio: 'pipe',
    })

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )
    await app.init()

    jwtService = app.get(JwtService)
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    await prisma.$connect()
  }, 120_000)

  afterAll(async () => {
    await app.close()
    await prisma.$disconnect()
    await container.stop()
  })

  afterEach(async () => {
    jest.clearAllMocks()
    mockSupabaseSignOut.mockResolvedValue({ error: null })
    mockSupabaseDeleteUser.mockResolvedValue({ error: null })
    await prisma.user.deleteMany()
    await prisma.tenant.deleteMany()
  })

  describe('POST /auth/register', () => {
    it('should create a tenant and user, returning a JWT with correct payload', async () => {
      successfulSignUp()

      const res = await request(app.getHttpServer()).post('/auth/register').send({
        email: 'alice@example.com',
        password: 'Password123',
        firstName: 'Alice',
        lastName: 'Smith',
        tenantName: 'ACME Corp',
      })

      expect(res.status).toBe(201)
      expect(res.body).toMatchObject({
        accessToken: expect.any(String),
        email: 'alice@example.com',
        roles: ['SALES_REP'],
      })

      const tokenPayload = jwtService.verify(res.body.accessToken as string) as Record<
        string,
        unknown
      >
      expect(tokenPayload).toMatchObject({
        sub: res.body.userId,
        userId: res.body.userId,
        tenantId: res.body.tenantId,
        roles: ['SALES_REP'],
      })

      const tenant = await prisma.tenant.findFirst({ where: { name: 'ACME Corp' } })
      expect(tenant).toBeTruthy()

      const userRecord = await prisma.user.findFirst({ where: { email: 'alice@example.com' } })
      expect(userRecord?.supabaseUserId).toBe(SUPABASE_UID_1)
      // role column is dropped — user exists with UserRole junction assignment instead
      expect(userRecord).toBeTruthy()
    })

    it('should return 400 when tenantName is missing', async () => {
      const res = await request(app.getHttpServer()).post('/auth/register').send({
        email: 'bob@example.com',
        password: 'Password123',
        firstName: 'Bob',
        lastName: 'Brown',
      })

      expect(res.status).toBe(400)
    })

    it('should return 400 when tenantName is only whitespace', async () => {
      const res = await request(app.getHttpServer()).post('/auth/register').send({
        email: 'blank@example.com',
        password: 'Password123',
        firstName: 'Blank',
        lastName: 'User',
        tenantName: '  ',
      })

      expect(res.status).toBe(400)
    })

    it('should return 400 when password is shorter than 8 characters', async () => {
      const res = await request(app.getHttpServer()).post('/auth/register').send({
        email: 'charlie@example.com',
        password: 'short',
        firstName: 'Charlie',
        lastName: 'Test',
        tenantName: 'Corp',
      })

      expect(res.status).toBe(400)
    })

    it('should return 409 when Supabase signals email already registered', async () => {
      mockSupabaseSignUp.mockResolvedValue({
        data: { user: null },
        error: { message: 'User already registered' },
      })

      const res = await request(app.getHttpServer()).post('/auth/register').send({
        email: 'dup@example.com',
        password: 'Password123',
        firstName: 'Dup',
        lastName: 'Test',
        tenantName: 'Corp',
      })

      expect(res.status).toBe(409)
    })
  })

  describe('POST /auth/login', () => {
    it('should return JWT when credentials are valid', async () => {
      successfulSignUp()
      await request(app.getHttpServer()).post('/auth/register').send({
        email: 'dave@example.com',
        password: 'Password123',
        firstName: 'Dave',
        lastName: 'Test',
        tenantName: 'Dave Corp',
      })

      successfulSignIn()
      const res = await request(app.getHttpServer()).post('/auth/login').send({
        email: 'dave@example.com',
        password: 'Password123',
      })

      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ accessToken: expect.any(String), email: 'dave@example.com' })
    })

    it('should return 401 when Supabase rejects credentials', async () => {
      mockSupabaseSignIn.mockResolvedValue({
        data: { user: null },
        error: { message: 'Invalid login credentials' },
      })

      const res = await request(app.getHttpServer()).post('/auth/login').send({
        email: 'nobody@example.com',
        password: 'WrongPass123',
      })

      expect(res.status).toBe(401)
    })
  })

  describe('POST /auth/logout', () => {
    it('should revoke token so it cannot be reused on a protected route', async () => {
      successfulSignUp(SUPABASE_UID_2)
      const registerRes = await request(app.getHttpServer()).post('/auth/register').send({
        email: 'eve@example.com',
        password: 'Password123',
        firstName: 'Eve',
        lastName: 'Test',
        tenantName: 'Eve Corp',
      })
      const { accessToken } = registerRes.body as { accessToken: string }

      const logoutRes = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
      expect(logoutRes.status).toBe(204)

      const reuseRes = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
      expect(reuseRes.status).toBe(401)
    })

    it('should return 401 without Authorization header (AC6 — JwtAuthGuard)', async () => {
      const res = await request(app.getHttpServer()).post('/auth/logout')

      expect(res.status).toBe(401)
    })
  })

  describe('POST /auth/login — supabaseUserId fallback', () => {
    it('should link supabaseUserId on first login after manual DB insert when exactly one user matches', async () => {
      successfulSignUp()
      const registerRes = await request(app.getHttpServer()).post('/auth/register').send({
        email: 'grace@example.com',
        password: 'Password123',
        firstName: 'Grace',
        lastName: 'Test',
        tenantName: 'Grace Corp',
      })
      expect(registerRes.status).toBe(201)

      await prisma.user.updateMany({
        where: { email: 'grace@example.com' },
        data: { supabaseUserId: null },
      })

      const newUid = '33333333-3333-3333-3333-333333333333'
      mockSupabaseSignIn.mockResolvedValue({ data: { user: { id: newUid } }, error: null })

      const loginRes = await request(app.getHttpServer()).post('/auth/login').send({
        email: 'grace@example.com',
        password: 'Password123',
      })

      expect(loginRes.status).toBe(200)
      const user = await prisma.user.findFirst({ where: { email: 'grace@example.com' } })
      expect(user?.supabaseUserId).toBe(newUid)
    })

    it('should reject ambiguous duplicate-email users across tenants', async () => {
      const firstTenant = await prisma.tenant.create({ data: { name: 'Tenant A' } })
      const secondTenant = await prisma.tenant.create({ data: { name: 'Tenant B' } })
      await prisma.user.createMany({
        data: [
          {
            tenantId: firstTenant.id,
            email: 'same@example.com',
            firstName: 'Same',
            lastName: 'A',
            createdBy: 'test',
            updatedBy: 'test',
          },
          {
            tenantId: secondTenant.id,
            email: 'same@example.com',
            firstName: 'Same',
            lastName: 'B',
            createdBy: 'test',
            updatedBy: 'test',
          },
        ],
      })

      mockSupabaseSignIn.mockResolvedValue({
        data: { user: { id: '44444444-4444-4444-4444-444444444444' } },
        error: null,
      })

      const loginRes = await request(app.getHttpServer()).post('/auth/login').send({
        email: 'same@example.com',
        password: 'Password123',
      })

      expect(loginRes.status).toBe(401)
    })
  })
})
