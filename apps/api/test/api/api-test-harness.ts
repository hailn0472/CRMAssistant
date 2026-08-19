import { execFileSync } from 'child_process'
import * as path from 'path'

import { INestApplication, ValidationPipe } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { PrismaClient } from '@prisma/client'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import request from 'supertest'

import { AppModule } from '../../src/app.module'

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { Tenant } from '@prisma/client'

export type GraphqlRequestPayload = {
  query: string
  variables?: Record<string, unknown>
  operationName?: string
}

export type ApiTestUser = {
  userId: string
  tenantId: string
  roles: string[]
  email: string
}

const TEST_JWT_SECRET = 'api-test-secret-that-is-long-enough-for-validation'

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

export class ApiTestHarness {
  private readonly container: StartedPostgreSqlContainer
  readonly app: INestApplication
  readonly prisma: PrismaClient
  readonly jwtService: JwtService

  private constructor(
    container: StartedPostgreSqlContainer,
    app: INestApplication,
    prisma: PrismaClient,
    jwtService: JwtService,
  ) {
    this.container = container
    this.app = app
    this.prisma = prisma
    this.jwtService = jwtService
  }

  static async start(): Promise<ApiTestHarness> {
    const container = await new PostgreSqlContainer('postgres:15-alpine').start()
    const databaseUrl = container.getConnectionUri()
    let app: INestApplication | undefined
    let prisma: PrismaClient | undefined

    try {
      ApiTestHarness.setTestEnvironment(databaseUrl)
      ApiTestHarness.applyMigrations(databaseUrl)

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
      app = moduleRef.createNestApplication()
      app.useGlobalPipes(
        new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
      )
      await app.init()

      prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
      await prisma.$connect()

      return new ApiTestHarness(container, app, prisma, app.get(JwtService))
    } catch (error) {
      await app?.close()
      await prisma?.$disconnect()
      await container.stop()
      throw error
    }
  }

  async stop(): Promise<void> {
    await this.app.close()
    await this.prisma.$disconnect()
    await this.container.stop()
  }

  async cleanupDatabase(): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "CustomerAnalyticsSnapshot", "ReportExport", "Contact", "User", "Tenant" RESTART IDENTITY CASCADE',
    )
    jest.clearAllMocks()
    mockSupabaseSignOut.mockResolvedValue({ error: null })
    mockSupabaseDeleteUser.mockResolvedValue({ error: null })
  }

  async createTenant(name: string): Promise<Tenant> {
    return this.prisma.tenant.create({ data: { name } })
  }

  signToken(input: ApiTestUser): string {
    return this.jwtService.sign({
      sub: input.userId,
      userId: input.userId,
      tenantId: input.tenantId,
      roles: input.roles,
      email: input.email,
    })
  }

  graphql(payload: GraphqlRequestPayload, token?: string): request.Test {
    const test = request(this.app.getHttpServer()).post('/graphql').send(payload)
    if (token) {
      test.set('Authorization', `Bearer ${token}`)
    }
    return test
  }

  static mockSupabaseSuccessfulSignIn(uid: string): void {
    mockSupabaseSignIn.mockResolvedValue({ data: { user: { id: uid } }, error: null })
  }

  static mockSupabaseRejectedSignIn(message: string): void {
    mockSupabaseSignIn.mockResolvedValue({ data: { user: null }, error: { message } })
  }

  private static setTestEnvironment(databaseUrl: string): void {
    process.env['NODE_ENV'] = 'test'
    process.env['DATABASE_URL'] = databaseUrl
    process.env['JWT_SECRET'] = TEST_JWT_SECRET
    process.env['SUPABASE_URL'] = 'https://test.supabase.co'
    process.env['SUPABASE_ANON_KEY'] = 'test-anon-key'
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-role-key'
    process.env['FRONTEND_URL'] = 'http://localhost:3000'
  }

  private static applyMigrations(databaseUrl: string): void {
    const prismaBin = path.resolve(__dirname, '../../node_modules/.bin/prisma')
    execFileSync(prismaBin, ['migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      cwd: path.resolve(__dirname, '../..'),
      stdio: 'pipe',
    })
  }
}
