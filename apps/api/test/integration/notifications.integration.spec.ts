import { execFileSync } from 'child_process'
import * as path from 'path'

import { INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { JwtService } from '@nestjs/jwt'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { PostgreSqlContainer } from '@testcontainers/postgresql'

import { AppModule } from '../../src/app.module'

import type { Tenant } from '@prisma/client'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'

// Story 4.8 integration (AC 78-79). Own TRUNCATE list with "Notification" FIRST —
// children before parents. Seeding order is load-bearing: Tenant → Role →
// Permission → User → UserRole → Team → Contact → DealStage → Deal/Task → Notification.

const CRUD = ['CREATE', 'READ', 'UPDATE', 'DELETE']

const ROLE_PERMISSIONS: Record<string, { resource: string; action: string }[]> = {
  ADMIN: [],
  SALES_REP: [
    ...CRUD.map((action) => ({ resource: 'CONTACT', action })),
    ...CRUD.map((action) => ({ resource: 'DEAL', action })),
  ],
  MARKETING_USER: [{ resource: 'CONTACT', action: 'READ' }],
}

const NOTIFICATION_FIELDS = `
  id type title body dealId taskId readAt createdAt
`

describe('Notifications (integration)', () => {
  let prisma: PrismaClient
  let container: StartedPostgreSqlContainer
  let app: INestApplication
  let jwtService: JwtService

  let emailCounter = 0
  function uniqueEmail(prefix: string): string {
    emailCounter += 1
    return `${prefix}-${emailCounter}-${Date.now()}@example.com`
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:15-alpine').start()

    const databaseUrl = container.getConnectionUri()
    process.env['DATABASE_URL'] = databaseUrl
    process.env['JWT_SECRET'] = 'test-jwt-secret-that-is-long-enough-for-validation'
    process.env['SUPABASE_URL'] = 'https://test.supabase.co'
    process.env['SUPABASE_ANON_KEY'] = 'test-anon-key'
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-role-key'
    process.env['SUPABASE_STORAGE_BUCKET'] = 'deal-documents'

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

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    await app.init()
    jwtService = app.get(JwtService)
  }, 120_000)

  afterAll(async () => {
    await app.close()
    await prisma.$disconnect()
    await container.stop()
  })

  // "Notification" MUST be first — children before parents.
  afterEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Notification", "Activity", "Note", "Deal", "DealStage", "Task", "Contact", "User", "UserRole", "Role", "Permission", "RolePermission", "Team", "Tenant", "AuditLog" RESTART IDENTITY CASCADE',
    )
  })

  // ─── Seeding helpers (copy from notes.integration.spec.ts:104-137) ────────

  async function createTenant(name: string): Promise<Tenant> {
    return prisma.tenant.create({ data: { name } })
  }

  /**
   * Idempotent per (tenantId, name).
   */
  async function createRole(
    tenantId: string,
    name: string,
    dataVisibility: 'OWN' | 'TEAM' | 'ALL' = 'OWN',
  ): Promise<string> {
    const role = await prisma.role.upsert({
      where: { tenantId_name: { tenantId, name } },
      update: {},
      create: {
        tenantId,
        name,
        isSystem: true,
        dataVisibility,
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    return role.id
  }

  async function grantPermissions(
    roleId: string,
    permissions: { resource: string; action: string }[],
  ): Promise<void> {
    for (const { resource, action } of permissions) {
      const permission = await prisma.permission.upsert({
        where: { resource_action: { resource, action } },
        create: { resource, action, description: '' },
        update: {},
      })
      // eslint-disable-next-line no-await-in-loop
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId: permission.id } },
        update: {},
        create: { roleId, permissionId: permission.id },
      })
    }
  }

  async function createUser(
    tenantId: string,
    userId: string,
    roles: string[] = ['SALES_REP'],
  ): Promise<void> {
    await prisma.user.create({
      data: {
        id: userId,
        tenantId,
        email: uniqueEmail(userId),
        firstName: 'Test',
        lastName: 'User',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    for (const roleName of roles) {
      const roleId = await createRole(tenantId, roleName, roleName === 'ADMIN' ? 'ALL' : 'OWN')
      const perms = ROLE_PERMISSIONS[roleName]
      if (perms && perms.length > 0) {
        await grantPermissions(roleId, perms)
      }
      // eslint-disable-next-line no-await-in-loop
      await prisma.userRole.create({ data: { userId, roleId, assignedBy: 'test' } })
    }
  }

  function tokenFor(tenantId: string, userId: string, roles: string[]): string {
    return jwtService.sign({
      sub: userId,
      userId,
      tenantId,
      roles,
      email: uniqueEmail('token'),
    })
  }

  async function graphqlRequest(
    token: string,
    query: string,
    variables: Record<string, unknown>,
  ): Promise<request.Response> {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send({ query, variables })
  }

  // ─── Seeding helper: create a notification directly via service ──────────

  async function seedNotification(
    tenantId: string,
    userId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const readAt = overrides.readAt as Date | null | undefined
    return prisma.notification.create({
      data: {
        tenantId,
        userId,
        type: (overrides.type as string) ?? 'TASK_ASSIGNED',
        title: (overrides.title as string) ?? 'Test notification',
        body: (overrides.body as string) ?? null,
        dealId: (overrides.dealId as string) ?? null,
        taskId: (overrides.taskId as string) ?? null,
        readAt: readAt !== undefined ? readAt : null,
        createdBy: (overrides.createdBy as string) ?? 'test',
        updatedBy: (overrides.updatedBy as string) ?? 'test',
      },
    })
  }

  // ─── Tests ───────────────────────────────────────────────────────────────

  describe('notifications query (AC 78)', () => {
    it('returns paginated notifications for the authenticated user', async () => {
      const tenant = await createTenant('Acme')
      await createUser(tenant.id, 'rep-1', ['SALES_REP'])
      const token = tokenFor(tenant.id, 'rep-1', ['SALES_REP'])

      await seedNotification(tenant.id, 'rep-1', { title: 'Notif 1' })
      await seedNotification(tenant.id, 'rep-1', { title: 'Notif 2', type: 'DEAL_REMINDER' })

      const res = await graphqlRequest(
        token,
        `query Notifications($filter: NotificationFilterInput, $pagination: NotificationPaginationInput) {
          notifications(filter: $filter, pagination: $pagination) {
            total page pageSize
            items { ${NOTIFICATION_FIELDS} }
          }
        }`,
        {},
      )

      expect(res.body.errors).toBeUndefined()
      const data = res.body.data.notifications as Record<string, unknown>
      expect(data['total']).toBe(2)
      expect(data['page']).toBe(1)
      expect(Array.isArray(data['items'])).toBe(true)
      expect((data['items'] as unknown[]).length).toBe(2)
    })

    it('filters by unreadOnly', async () => {
      const tenant = await createTenant('Acme')
      await createUser(tenant.id, 'rep-1', ['SALES_REP'])
      const token = tokenFor(tenant.id, 'rep-1', ['SALES_REP'])

      await seedNotification(tenant.id, 'rep-1', { title: 'Unread', readAt: null })
      await seedNotification(tenant.id, 'rep-1', {
        title: 'Already read',
        readAt: new Date(),
      })

      const res = await graphqlRequest(
        token,
        `query Notifications($filter: NotificationFilterInput) {
          notifications(filter: $filter) {
            total items { id title readAt }
          }
        }`,
        { filter: { unreadOnly: true } },
      )

      expect(res.body.errors).toBeUndefined()
      const data = res.body.data.notifications as Record<string, unknown>
      expect(data['total']).toBe(1)
      const items = data['items'] as Array<Record<string, unknown>>
      expect(items[0]['title']).toBe('Unread')
    })

    it("does not return another user's notifications (cross-user negative)", async () => {
      const tenant = await createTenant('Acme')
      await createUser(tenant.id, 'rep-1', ['SALES_REP'])
      await createUser(tenant.id, 'rep-2', ['SALES_REP'])
      const token = tokenFor(tenant.id, 'rep-1', ['SALES_REP'])

      await seedNotification(tenant.id, 'rep-2', { title: 'Rep 2 notif' })

      const res = await graphqlRequest(
        token,
        `query Notifications { notifications { total items { id title } } }`,
        {},
      )

      expect(res.body.errors).toBeUndefined()
      const data = res.body.data.notifications as Record<string, unknown>
      expect(data['total']).toBe(0)
    })

    it('does not return notifications from another tenant (cross-tenant negative)', async () => {
      const tenant1 = await createTenant('Acme')
      const tenant2 = await createTenant('Globex')
      await createUser(tenant1.id, 'rep-1', ['SALES_REP'])
      await createUser(tenant2.id, 'rep-2', ['SALES_REP'])
      const token = tokenFor(tenant1.id, 'rep-1', ['SALES_REP'])

      await seedNotification(tenant2.id, 'rep-2', { title: 'Other tenant' })

      const res = await graphqlRequest(
        token,
        `query Notifications { notifications { total items { id title } } }`,
        {},
      )

      expect(res.body.errors).toBeUndefined()
      const data = res.body.data.notifications as Record<string, unknown>
      expect(data['total']).toBe(0)
    })
  })

  describe('unreadNotificationCount query', () => {
    it('returns the unread count for the authenticated user', async () => {
      const tenant = await createTenant('Acme')
      await createUser(tenant.id, 'rep-1', ['SALES_REP'])
      const token = tokenFor(tenant.id, 'rep-1', ['SALES_REP'])

      await seedNotification(tenant.id, 'rep-1', { title: 'Notif 1' })
      await seedNotification(tenant.id, 'rep-1', { title: 'Notif 2', readAt: new Date() })
      await seedNotification(tenant.id, 'rep-1', { title: 'Notif 3' })

      const res = await graphqlRequest(token, `query { unreadNotificationCount }`, {})

      expect(res.body.errors).toBeUndefined()
      expect(res.body.data.unreadNotificationCount).toBe(2)
    })

    it('returns 0 for a user with no notifications', async () => {
      const tenant = await createTenant('Acme')
      await createUser(tenant.id, 'rep-1', ['SALES_REP'])
      const token = tokenFor(tenant.id, 'rep-1', ['SALES_REP'])

      const res = await graphqlRequest(token, `query { unreadNotificationCount }`, {})

      expect(res.body.errors).toBeUndefined()
      expect(res.body.data.unreadNotificationCount).toBe(0)
    })
  })

  describe('markNotificationRead mutation (AC 79)', () => {
    it('marks a notification as read and returns it', async () => {
      const tenant = await createTenant('Acme')
      await createUser(tenant.id, 'rep-1', ['SALES_REP'])
      const token = tokenFor(tenant.id, 'rep-1', ['SALES_REP'])

      const notif = await seedNotification(tenant.id, 'rep-1', { title: 'Mark me' })

      const res = await graphqlRequest(
        token,
        `mutation MarkNotificationRead($id: ID!) {
          markNotificationRead(id: $id) { ${NOTIFICATION_FIELDS} }
        }`,
        { id: notif.id },
      )

      expect(res.body.errors).toBeUndefined()
      const data = res.body.data.markNotificationRead as Record<string, unknown>
      expect(data['id']).toBe(notif.id)
      expect(data['readAt']).not.toBeNull()
    })

    it('is idempotent for already-read notification', async () => {
      const tenant = await createTenant('Acme')
      await createUser(tenant.id, 'rep-1', ['SALES_REP'])
      const token = tokenFor(tenant.id, 'rep-1', ['SALES_REP'])

      const notif = await seedNotification(tenant.id, 'rep-1', {
        title: 'Already read',
        readAt: new Date(),
      })

      const res = await graphqlRequest(
        token,
        `mutation MarkNotificationRead($id: ID!) {
          markNotificationRead(id: $id) { id readAt }
        }`,
        { id: notif.id },
      )

      expect(res.body.errors).toBeUndefined()
      expect(res.body.data.markNotificationRead.readAt).not.toBeNull()
    })

    it("returns error when marking another user's notification", async () => {
      const tenant = await createTenant('Acme')
      await createUser(tenant.id, 'rep-1', ['SALES_REP'])
      await createUser(tenant.id, 'rep-2', ['SALES_REP'])
      const token = tokenFor(tenant.id, 'rep-1', ['SALES_REP'])

      const notif = await seedNotification(tenant.id, 'rep-2', { title: 'Rep 2 notif' })

      const res = await graphqlRequest(
        token,
        `mutation MarkNotificationRead($id: ID!) {
          markNotificationRead(id: $id) { id }
        }`,
        { id: notif.id },
      )

      expect(res.body.errors).toBeDefined()
      expect(res.body.errors[0].message).toContain('Notification not found')
    })

    it('returns error for non-existent notification', async () => {
      const tenant = await createTenant('Acme')
      await createUser(tenant.id, 'rep-1', ['SALES_REP'])
      const token = tokenFor(tenant.id, 'rep-1', ['SALES_REP'])

      const res = await graphqlRequest(
        token,
        `mutation MarkNotificationRead($id: ID!) {
          markNotificationRead(id: $id) { id }
        }`,
        { id: 'nonexistent-id' },
      )

      expect(res.body.errors).toBeDefined()
    })
  })

  describe('markAllNotificationsRead mutation', () => {
    it('marks all unread notifications as read and returns count', async () => {
      const tenant = await createTenant('Acme')
      await createUser(tenant.id, 'rep-1', ['SALES_REP'])
      const token = tokenFor(tenant.id, 'rep-1', ['SALES_REP'])

      await seedNotification(tenant.id, 'rep-1', { title: 'Notif 1' })
      await seedNotification(tenant.id, 'rep-1', { title: 'Notif 2' })

      const res = await graphqlRequest(token, `mutation { markAllNotificationsRead }`, {})

      expect(res.body.errors).toBeUndefined()
      expect(res.body.data.markAllNotificationsRead).toBe(2)
    })

    it('returns 0 when no unread notifications exist', async () => {
      const tenant = await createTenant('Acme')
      await createUser(tenant.id, 'rep-1', ['SALES_REP'])
      const token = tokenFor(tenant.id, 'rep-1', ['SALES_REP'])

      const res = await graphqlRequest(token, `mutation { markAllNotificationsRead }`, {})

      expect(res.body.errors).toBeUndefined()
      expect(res.body.data.markAllNotificationsRead).toBe(0)
    })
  })

  describe('minimal-permission positive (MARKETING_USER can read own notifications)', () => {
    it('allows MARKETING_USER to query their own notifications', async () => {
      const tenant = await createTenant('Acme')
      await createUser(tenant.id, 'marketing-1', ['MARKETING_USER'])
      const token = tokenFor(tenant.id, 'marketing-1', ['MARKETING_USER'])

      await seedNotification(tenant.id, 'marketing-1', { title: 'Marketing alert' })

      const res = await graphqlRequest(
        token,
        `query Notifications { notifications { total items { id title } } }`,
        {},
      )

      expect(res.body.errors).toBeUndefined()
      const data = res.body.data.notifications as Record<string, unknown>
      expect(data['total']).toBe(1)
    })
  })
})
