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

import { AppModule } from '../../src/app.module'
import { PrismaService } from '../../src/prisma/prisma.service'

describe('Health (integration)', () => {
  let app: INestApplication
  let container: StartedPostgreSqlContainer

  beforeAll(async () => {
    // Start a real PostgreSQL container
    container = await new PostgreSqlContainer('postgres:15-alpine').start()

    // Set DATABASE_URL to point to the test container
    process.env['DATABASE_URL'] = container.getConnectionUri()

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
