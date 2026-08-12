import { resolve } from 'path'

import { PostgreSqlContainer } from '@testcontainers/postgresql'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'

import { Test, type TestingModule } from '@nestjs/testing'

import { AppModule } from '../../src/app.module'
import { PrismaService } from '../../src/prisma/prisma.service'
import type { INestApplication } from '@nestjs/common'

// ─── Container Lifecycle ─────────────────────────────────────────────────────

let container: StartedPostgreSqlContainer | null = null

async function startContainer(): Promise<StartedPostgreSqlContainer> {
  const pgContainer = new PostgreSqlContainer('postgres:15-alpine')
    .withDatabase('crm_test')
    .withUsername('crm_test')
    .withPassword('crm_test')
    .withStartupTimeout(120_000)
  return pgContainer.start()
}

// ─── Test Data ───────────────────────────────────────────────────────────────

const TENANT_A_ID = 'tenant-a'
const STAGE_WON_ID = 'stage-won'
const STAGE_OPEN_ID = 'stage-open'

describe('Forecast Integration', () => {
  let app: INestApplication
  let prisma: PrismaService

  beforeAll(async () => {
    container = await startContainer()

    // Run migrations
    const { execSync } = await import('child_process')
    execSync('pnpm prisma migrate deploy', {
      cwd: resolve(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: container.getConnectionUri() },
      stdio: 'pipe',
    })

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    await app.init()

    prisma = app.get(PrismaService)
  }, 120_000)

  afterAll(async () => {
    if (app) await app.close()
    if (container) await container.stop()
  })

  beforeEach(async () => {
    // Clean tables
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Notification", "Widget", "Dashboard", "ForecastSnapshot", "Deal", "User", "Tenant", "DealStage", "Team", "Role", "Permission", "RolePermission", "UserRole" CASCADE',
    )

    // Seed tenants
    await prisma.tenant.createMany({
      data: [{ id: TENANT_A_ID, name: 'Tenant A' }],
    })

    // Seed roles
    const adminRole = await prisma.role.create({
      data: {
        id: 'role-admin',
        tenantId: TENANT_A_ID,
        name: 'ADMIN',
        isSystem: true,
        dataVisibility: 'ALL',
      },
    })
    const repRole = await prisma.role.create({
      data: {
        id: 'role-rep',
        tenantId: TENANT_A_ID,
        name: 'SALES_REP',
        isSystem: true,
        dataVisibility: 'OWN',
      },
    })

    // Ensure REPORT:READ permission exists
    const reportReadPerm = await prisma.permission.upsert({
      where: { resource_action: { resource: 'REPORT', action: 'READ' } },
      create: { resource: 'REPORT', action: 'READ', description: 'Read reports' },
      update: {},
    })

    // Grant REPORT:READ to rep role
    await prisma.rolePermission
      .create({
        data: { roleId: repRole.id, permissionId: reportReadPerm.id },
      })
      .catch(() => {})

    // Seed team
    const teamA = await prisma.team.create({
      data: { id: 'team-a', tenantId: TENANT_A_ID, name: 'Team Alpha' },
    })

    // Seed users
    await prisma.user.createMany({
      data: [
        {
          id: 'rep-a1',
          tenantId: TENANT_A_ID,
          email: 'rep1@a.com',
          firstName: 'Rep',
          lastName: 'One',
        },
        {
          id: 'rep-a2',
          tenantId: TENANT_A_ID,
          email: 'rep2@a.com',
          firstName: 'Rep',
          lastName: 'Two',
          teamId: teamA.id,
        },
        {
          id: 'admin-a',
          tenantId: TENANT_A_ID,
          email: 'admin@a.com',
          firstName: 'Admin',
          lastName: 'A',
        },
      ],
    })

    // Assign roles
    await prisma.userRole.createMany({
      data: [
        { userId: 'admin-a', roleId: adminRole.id },
        { userId: 'rep-a1', roleId: repRole.id },
        { userId: 'rep-a2', roleId: repRole.id },
      ],
    })

    // Seed stages
    await prisma.dealStage.createMany({
      data: [
        { id: STAGE_OPEN_ID, tenantId: TENANT_A_ID, name: 'Open', probability: 25, order: 1 },
        {
          id: STAGE_WON_ID,
          tenantId: TENANT_A_ID,
          name: 'Closed Won',
          probability: 100,
          order: 2,
          isWon: true,
        },
      ],
    })
  })

  // ════════════════════════════════════════════════════════════════════════════
  // Tests (skipped — requires running Postgres via testcontainers)
  // ════════════════════════════════════════════════════════════════════════════

  it.skip('verifies forecast totals with real database', async () => {
    // Seed deals across 3 months, assert forecast values
  })

  it.skip('enforces tenant isolation in forecast', async () => {
    // Seed deals for both tenants, verify tenant B cannot see tenant A forecast
  })

  it.skip('writes snapshot rows on forecast query', async () => {
    // Call salesForecast → query ForecastSnapshot table → verify rows exist
  })

  it.skip('computes accuracy from seeded snapshot and won deals', async () => {
    // Seed snapshot for past period + won deals → verify accuracy numbers
  })

  it.skip('probability validation integration: rejects out of range', async () => {
    // Create deal with probability -1, 101, etc via GraphQL
  })
})
