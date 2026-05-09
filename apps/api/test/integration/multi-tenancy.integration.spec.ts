/**
 * Backend Integration Test: Multi-Tenancy Database Patterns (Story 1.6)
 *
 * Prerequisites:
 * - Docker must be running (for @testcontainers/postgresql)
 * - Run with: pnpm test:integration (from apps/api or root)
 *
 * Validates:
 * - AC #2: User model has tenantId and relation to Tenant
 * - AC #3: tenant-scoped unique email — same email allowed in different tenants,
 *           but rejected within the same tenant
 * - AC #7: seeded sample data can be queried with tenant filters
 * - AC #9: real PostgreSQL via Testcontainers (no mocks)
 */

import { execFileSync } from 'child_process'
import * as path from 'path'

import { PrismaClient } from '@prisma/client'
import { PostgreSqlContainer } from '@testcontainers/postgresql'

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { Tenant, User } from '@prisma/client'

describe('Multi-Tenancy Database Patterns (integration)', () => {
  let prisma: PrismaClient
  let container: StartedPostgreSqlContainer

  beforeAll(async () => {
    // Start a real PostgreSQL 15 container
    container = await new PostgreSqlContainer('postgres:15-alpine').start()

    const databaseUrl = container.getConnectionUri()
    process.env['DATABASE_URL'] = databaseUrl

    // Apply Prisma migrations to the ephemeral container
    // Uses prisma migrate deploy (non-interactive, CI-safe)
    const prismaBin = path.resolve(__dirname, '../../node_modules/.bin/prisma')
    execFileSync(prismaBin, ['migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      cwd: path.resolve(__dirname, '../..'),
      stdio: 'pipe',
    })

    prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    })
    await prisma.$connect()
  }, 120_000) // Allow up to 2 minutes for container startup + migrations

  afterAll(async () => {
    await prisma.$disconnect()
    await container.stop()
  })

  afterEach(async () => {
    // Clean up between tests — order matters for FK constraints
    await prisma.user.deleteMany()
    await prisma.tenant.deleteMany()
  })

  // ── Helpers ──────────────────────────────────────────────────────────────

  async function createTenant(name: string): Promise<Tenant> {
    return prisma.tenant.create({ data: { name } })
  }

  async function createUser(tenantId: string, email: string, name: string): Promise<User> {
    return prisma.user.create({
      data: { tenantId, email, name, createdBy: 'test', updatedBy: 'test' },
    })
  }

  // ── Test: Tenant model ────────────────────────────────────────────────────

  it('creates a Tenant record with id, name, createdAt, updatedAt', async () => {
    const tenant = await createTenant('Test Corp')

    expect(tenant.id).toBeTruthy()
    expect(tenant.name).toBe('Test Corp')
    expect(tenant.createdAt).toBeInstanceOf(Date)
    expect(tenant.updatedAt).toBeInstanceOf(Date)
  })

  // ── Test: AC #2 — User has tenantId and tenant relation ──────────────────

  it('creates a User with tenantId, audit fields, and optional deletedAt (AC #2, #4, #5)', async () => {
    const tenant = await createTenant('Acme')
    const user = await createUser(tenant.id, 'alice@example.com', 'Alice')

    expect(user.tenantId).toBe(tenant.id)
    expect(user.email).toBe('alice@example.com')
    expect(user.createdAt).toBeInstanceOf(Date)
    expect(user.updatedAt).toBeInstanceOf(Date)
    expect(user.createdBy).toBeTruthy()
    expect(user.updatedBy).toBeTruthy()
    expect(user.deletedAt).toBeNull() // soft delete: null means active
  })

  it('can query a User with its Tenant relation (AC #2)', async () => {
    const tenant = await createTenant('Acme')
    await createUser(tenant.id, 'alice@example.com', 'Alice')

    const userWithTenant = await prisma.user.findFirst({
      where: { tenantId: tenant.id },
      include: { tenant: true },
    })

    expect(userWithTenant).not.toBeNull()
    expect(userWithTenant?.tenant.name).toBe('Acme')
  })

  // ── Test: AC #3 — Tenant-scoped email uniqueness ──────────────────────────

  it('allows the same email in different tenants (AC #3, #9)', async () => {
    const tenantA = await createTenant('Tenant A')
    const tenantB = await createTenant('Tenant B')

    // Same email in two different tenants — must succeed
    await expect(createUser(tenantA.id, 'shared@example.com', 'Alice A')).resolves.toBeTruthy()
    await expect(createUser(tenantB.id, 'shared@example.com', 'Alice B')).resolves.toBeTruthy()
  })

  it('rejects duplicate email within the same tenant (AC #3, #9)', async () => {
    const tenant = await createTenant('Tenant A')

    await createUser(tenant.id, 'dup@example.com', 'First User')

    // Second user with same email in same tenant — must fail (@@unique([tenantId, email]))
    await expect(createUser(tenant.id, 'dup@example.com', 'Second User')).rejects.toThrow()
  })

  // ── Test: AC #7, #9 — Tenant-filtered query returns only own-tenant users ─

  it('tenant-filtered query returns only users for the requested tenant (AC #7, #9)', async () => {
    const tenantA = await createTenant('Tenant A')
    const tenantB = await createTenant('Tenant B')

    await createUser(tenantA.id, 'alice@example.com', 'Alice (A)')
    await createUser(tenantA.id, 'bob@example.com', 'Bob (A)')
    await createUser(tenantB.id, 'carol@example.com', 'Carol (B)')

    const tenantAUsers = await prisma.user.findMany({
      where: { tenantId: tenantA.id },
      select: { email: true },
    })

    expect(tenantAUsers).toHaveLength(2)
    expect(tenantAUsers.map((u) => u.email)).toEqual(
      expect.arrayContaining(['alice@example.com', 'bob@example.com']),
    )
    // Carol from Tenant B must NOT appear
    expect(tenantAUsers.map((u) => u.email)).not.toContain('carol@example.com')
  })

  // ── Test: AC #5 — Soft delete pattern ────────────────────────────────────

  it('soft-deletes a user by setting deletedAt (AC #5)', async () => {
    const tenant = await createTenant('Acme')
    const user = await createUser(tenant.id, 'softdelete@example.com', 'Soft Deleted User')

    const softDeleted = await prisma.user.update({
      where: { id: user.id },
      data: { deletedAt: new Date(), updatedBy: 'system' },
    })

    expect(softDeleted.deletedAt).toBeInstanceOf(Date)

    // Active-only query excludes soft-deleted user
    const activeUsers = await prisma.user.findMany({
      where: { tenantId: tenant.id, deletedAt: null },
    })
    expect(activeUsers).toHaveLength(0)
  })

  // ── Test: Cascade delete — deleting Tenant cascades to Users ─────────────

  it('deleting a Tenant cascades and removes its Users', async () => {
    const tenant = await createTenant('Delete Me Corp')
    await createUser(tenant.id, 'user@deleteme.com', 'Delete Me User')

    await prisma.tenant.delete({ where: { id: tenant.id } })

    const remaining = await prisma.user.findMany({ where: { tenantId: tenant.id } })
    expect(remaining).toHaveLength(0)
  })
})
