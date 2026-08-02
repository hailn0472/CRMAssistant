import { execFileSync } from 'child_process'
import * as path from 'path'
import { INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { AppModule } from '../../src/app.module'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'

describe('rest debug', () => {
  let prisma: PrismaClient
  let container: StartedPostgreSqlContainer
  let app: INestApplication

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:15-alpine').start()
    const databaseUrl = container.getConnectionUri()
    process.env['DATABASE_URL'] = databaseUrl
    process.env['JWT_SECRET'] = 'test-jwt-secret-that-is-long-enough-for-validation'
    process.env['SUPABASE_URL'] = 'https://test.supabase.co'
    process.env['SUPABASE_ANON_KEY'] = 'test-anon-key'
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-role-key'
    const prismaBin = path.resolve(__dirname, '../../node_modules/.bin/prisma')
    execFileSync(prismaBin, ['migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      cwd: path.resolve(__dirname, '../..'),
      stdio: 'pipe',
    })
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    await prisma.$connect()
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    app = moduleFixture.createNestApplication()
    await app.init()
  }, 120_000)
  afterAll(async () => {
    await app.close()
    await prisma.$disconnect()
    await container.stop()
  })

  it('hits a REST endpoint', async () => {
    const res = await request(app.getHttpServer()).get('/health').send()
    console.log('HEALTH_RESP:', res.status)
    await new Promise((r) => setTimeout(r, 500))
    expect(true).toBe(true)
  })
})
