/**
 * Backend Integration Test: Health endpoint with real NestJS app
 *
 * Prerequisites:
 * - Docker must be running (for @testcontainers/postgresql)
 * - Run with: pnpm test:integration (from apps/api or root)
 *
 * This test starts a real PostgreSQL container via Testcontainers,
 * sets DATABASE_URL, and boots the full NestJS app without mocking.
 */

import { INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import request from 'supertest'

// Mock Supabase so health tests don't require real Supabase credentials
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: {
      signUp: jest.fn(),
      signInWithPassword: jest.fn(),
      signOut: jest.fn(),
      admin: { deleteUser: jest.fn() },
    },
  })),
}))

import { AppModule } from '../../src/app.module'
import { PrismaService } from '../../src/prisma/prisma.service'

describe('Health (integration)', () => {
  let app: INestApplication
  let container: StartedPostgreSqlContainer

  beforeAll(async () => {
    // Start a real PostgreSQL container
    container = await new PostgreSqlContainer('postgres:15-alpine').start()

    // Set required environment variables
    process.env['DATABASE_URL'] = container.getConnectionUri()
    process.env['SUPABASE_URL'] = 'https://test.supabase.co'
    process.env['SUPABASE_ANON_KEY'] = 'test-anon-key'
    process.env['JWT_SECRET'] = 'health-test-secret-minimum-32-chars!!'

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    await app.init()
  }, 120_000) // Allow up to 2 minutes for container startup

  afterAll(async () => {
    await app.close()
    await container.stop()
  })

  describe('GET /health', () => {
    it('should return status ok with real database connection', async () => {
      const response = await request(app.getHttpServer()).get('/health').expect(200)

      expect(response.body).toEqual({ status: 'ok' })
    })

    it('should execute a real database query through Prisma', async () => {
      const prisma = app.get(PrismaService)

      await expect(prisma.$queryRaw`SELECT 1 AS value`).resolves.toEqual([{ value: 1 }])
    })
  })
})
