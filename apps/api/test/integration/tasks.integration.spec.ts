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

const TASK_PERMISSIONS: Record<string, { resource: string; action: string }[]> = {
  // ADMIN needs no TASK rows — requirePermission bypasses on the JWT role name
  // and resolveVisibilityFilter bypasses on the DB role name 'ADMIN'.
  ADMIN: [{ resource: 'DATA', action: 'VIEW_ALL' }],
  SALES_MANAGER: ['CREATE', 'READ', 'UPDATE', 'DELETE', 'ASSIGN'].map((action) => ({
    resource: 'TASK',
    action,
  })),
  SALES_REP: ['CREATE', 'READ', 'UPDATE', 'DELETE'].map((action) => ({
    resource: 'TASK',
    action,
  })),
  SUPPORT_AGENT: ['READ', 'UPDATE'].map((action) => ({ resource: 'TASK', action })),
}

const TASK_FIELDS = `
  id title description status priority dueDate assignedTo contactId dealId completedAt
  createdAt updatedAt createdBy
  assignee { id firstName lastName email }
  contact { id firstName lastName email }
  deal { id title }
`

describe('Task CRUD with templates and assignment (integration)', () => {
  let prisma: PrismaClient
  let container: StartedPostgreSqlContainer
  let app: INestApplication
  let jwtService: JwtService

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

  // AC 89 — Task/TaskTemplate first (children before parents).
  afterEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Task", "TaskTemplate", "Deal", "DealStage", "Contact", "User", "UserRole", "Role", "Permission", "RolePermission", "Team", "Tenant", "AuditLog" RESTART IDENTITY CASCADE',
    )
  })

  // ─── Seeding helpers (AC 90 — order is load-bearing) ────────────────────

  async function createTenant(name: string): Promise<Tenant> {
    return prisma.tenant.create({ data: { name } })
  }

  async function createRole(
    tenantId: string,
    name: string,
    dataVisibility: string,
  ): Promise<string> {
    const role = await prisma.role.create({
      data: {
        tenantId,
        name,
        isSystem: true,
        dataVisibility: dataVisibility as 'OWN' | 'TEAM' | 'ALL',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    return role.id
  }

  async function grantTaskPermissions(
    roleId: string,
    permissions: { resource: string; action: string }[],
  ): Promise<void> {
    for (const { resource, action } of permissions) {
      // Permission is globally unique per (resource, action) — upsert and
      // share the same row across roles.
      const permission = await prisma.permission.upsert({
        where: { resource_action: { resource, action } },
        create: { resource, action, description: '' },
        update: {},
      })
      await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } })
    }
  }

  async function createUser(tenantId: string, userId: string, roleId: string): Promise<void> {
    await prisma.user.create({
      data: {
        id: userId,
        tenantId,
        email: `${userId}@test.local`,
        firstName: 'Test',
        lastName: 'User',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    await prisma.userRole.create({ data: { userId, roleId, assignedBy: 'test' } })
  }

  // Contact must be created AFTER the User — Contact.ownerId is a FK to User.
  async function createContact(
    tenantId: string,
    email: string,
    ownerId: string,
  ): Promise<{ id: string }> {
    return prisma.contact.create({
      data: {
        tenantId,
        email,
        firstName: 'Ada',
        lastName: 'Lovelace',
        ownerId,
        createdBy: ownerId,
        updatedBy: ownerId,
      },
      select: { id: true },
    })
  }

  async function createDealStage(
    tenantId: string,
    name: string,
    order: number,
  ): Promise<{ id: string }> {
    return prisma.dealStage.create({
      data: {
        tenantId,
        name,
        order,
        probability: 25,
        color: '#3B82F6',
        createdBy: 'system',
        updatedBy: 'system',
      },
      select: { id: true },
    })
  }

  async function createDeal(
    tenantId: string,
    stageId: string,
    contactId: string,
    ownerId: string,
    title: string,
  ): Promise<{ id: string }> {
    return prisma.deal.create({
      data: {
        tenantId,
        title,
        value: 100000,
        currency: 'USD',
        probability: 25,
        stageId,
        contactId,
        ownerId,
        createdBy: ownerId,
        updatedBy: ownerId,
      },
      select: { id: true },
    })
  }

  function tokenFor(tenantId: string, userId: string, roles: string[]): string {
    return jwtService.sign({
      sub: userId,
      userId,
      tenantId,
      roles,
      email: `${userId}@test.local`,
    })
  }

  function graphqlRequest(
    token: string,
    query: string,
    variables: Record<string, unknown>,
  ): request.Test {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send({ query, variables })
  }

  /**
   * Seeds one tenant with ADMIN (ALL), SALES_MANAGER (ALL), SALES_REP (OWN)
   * and SUPPORT_AGENT (OWN) roles, one user per role, plus a stage, a contact
   * and a deal all owned by the rep. The ADMIN token carries a real ADMIN DB
   * role row with dataVisibility 'ALL' — resolveVisibilityFilter reads roles
   * from the database, not from the JWT.
   */
  async function seedTenant(
    name: string,
    suffix: string,
  ): Promise<{
    tenantId: string
    adminToken: string
    managerToken: string
    repToken: string
    supportToken: string
    repId: string
    managerId: string
    supportId: string
    contactId: string
    dealId: string
  }> {
    const tenant = await createTenant(`${name}-${suffix}`)

    const adminRoleId = await createRole(tenant.id, 'ADMIN', 'ALL')
    const managerRoleId = await createRole(tenant.id, 'SALES_MANAGER', 'ALL')
    const repRoleId = await createRole(tenant.id, 'SALES_REP', 'OWN')
    const supportRoleId = await createRole(tenant.id, 'SUPPORT_AGENT', 'OWN')

    await grantTaskPermissions(adminRoleId, TASK_PERMISSIONS['ADMIN'])
    await grantTaskPermissions(managerRoleId, TASK_PERMISSIONS['SALES_MANAGER'])
    await grantTaskPermissions(repRoleId, TASK_PERMISSIONS['SALES_REP'])
    await grantTaskPermissions(supportRoleId, TASK_PERMISSIONS['SUPPORT_AGENT'])

    const adminId = `admin-${suffix}`
    const managerId = `manager-${suffix}`
    const repId = `rep-${suffix}`
    const supportId = `support-${suffix}`
    await createUser(tenant.id, adminId, adminRoleId)
    await createUser(tenant.id, managerId, managerRoleId)
    await createUser(tenant.id, repId, repRoleId)
    await createUser(tenant.id, supportId, supportRoleId)

    const stage = await createDealStage(tenant.id, `Stage-${suffix}`, 1)
    const contact = await createContact(tenant.id, `contact-${suffix}@test.local`, repId)
    const deal = await createDeal(tenant.id, stage.id, contact.id, repId, `Deal-${suffix}`)

    return {
      tenantId: tenant.id,
      adminToken: tokenFor(tenant.id, adminId, ['ADMIN']),
      managerToken: tokenFor(tenant.id, managerId, ['SALES_MANAGER']),
      repToken: tokenFor(tenant.id, repId, ['SALES_REP']),
      supportToken: tokenFor(tenant.id, supportId, ['SUPPORT_AGENT']),
      repId,
      managerId,
      supportId,
      contactId: contact.id,
      dealId: deal.id,
    }
  }

  async function createTaskViaGraphql(
    token: string,
    input: Record<string, unknown>,
  ): Promise<{ id: string }> {
    const response = await graphqlRequest(
      token,
      `mutation CreateTask($input: CreateTaskInput!) {
        createTask(input: $input) { id }
      }`,
      { input },
    )
    expect(response.status).toBe(200)
    expect(response.body.errors).toBeUndefined()
    return { id: response.body.data.createTask.id }
  }

  // The audit interceptor writes asynchronously (fire-and-forget tap), so poll
  // briefly instead of racing the mutation response. CI runners are slow — the
  // 2s window once raced the interceptor here, so allow up to 10s.
  async function findAuditRow(where: {
    tenantId: string
    action: string
    entity: string
  }): Promise<{ entityId: string; userId: string } | null> {
    for (let attempt = 0; attempt < 50; attempt++) {
      const row = await prisma.auditLog.findFirst({ where })
      if (row) {
        return { entityId: row.entityId, userId: row.userId }
      }
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    return null
  }

  // ─── Cross-tenant isolation (AC 25, AC 91) ───────────────────────────────

  describe('tenant isolation', () => {
    it('returns null + Task not found when tenant A reads tenant B task', async () => {
      const tenantA = await seedTenant('Acme', 'a')
      const tenantB = await seedTenant('Globex', 'b')

      // Tenant B's task, owned by B's rep.
      const foreignTask = await prisma.task.create({
        data: {
          tenantId: tenantB.tenantId,
          title: 'Foreign task',
          assignedTo: tenantB.repId,
          createdBy: 'test',
          updatedBy: 'test',
        },
        select: { id: true },
      })

      const response = await graphqlRequest(
        tenantA.repToken,
        `query Task($id: ID!) { task(id: $id) { id title } }`,
        { id: foreignTask.id },
      )

      expect(response.status).toBe(200)
      expect(response.body.data.task).toBeNull()
      expect(response.body.errors[0].message).toBe('Task not found')
    })
  })

  // ─── createTask (AC 29-31, AC 91) ────────────────────────────────────────

  describe('createTask', () => {
    it('round-trips through task(id) with nested assignee/contact/deal refs', async () => {
      const { repToken, repId, contactId, dealId } = await seedTenant('Acme', 'rt')

      const createResponse = await graphqlRequest(
        repToken,
        `mutation CreateTask($input: CreateTaskInput!) {
          createTask(input: $input) { ${TASK_FIELDS} }
        }`,
        {
          input: {
            title: 'Follow up with Acme',
            description: 'Call the buyer',
            priority: 'HIGH',
            dueDate: '2026-08-10T00:00:00.000Z',
            contactId,
            dealId,
          },
        },
      )

      expect(createResponse.status).toBe(200)
      expect(createResponse.body.errors).toBeUndefined()
      const created = createResponse.body.data.createTask
      expect(created.title).toBe('Follow up with Acme')
      expect(created.description).toBe('Call the buyer')
      // assignedTo defaults to the creating user (AC 30)
      expect(created.assignedTo).toBe(repId)
      expect(created.status).toBe('TODO')
      expect(created.priority).toBe('HIGH')
      expect(created.dueDate).toBe('2026-08-10T00:00:00.000Z')
      expect(created.completedAt).toBeNull()
      expect(created.assignee.id).toBe(repId)
      expect(created.assignee.email).toBe(`${repId}@test.local`)
      expect(created.contact.id).toBe(contactId)
      expect(created.contact.email).toBe('contact-rt@test.local')
      expect(created.deal.id).toBe(dealId)
      expect(created.deal.title).toBe('Deal-rt')

      const readResponse = await graphqlRequest(
        repToken,
        `query Task($id: ID!) { task(id: $id) { ${TASK_FIELDS} } }`,
        { id: created.id },
      )
      expect(readResponse.body.errors).toBeUndefined()
      const task = readResponse.body.data.task
      expect(task.id).toBe(created.id)
      expect(task.title).toBe('Follow up with Acme')
      expect(task.assignedTo).toBe(repId)
      expect(task.assignee.id).toBe(repId)
      expect(task.contact.id).toBe(contactId)
      expect(task.deal.id).toBe(dealId)
    })

    it('rejects a foreign assignedTo for SALES_REP and allows it for SALES_MANAGER (AC 51)', async () => {
      const { repToken, managerToken, managerId, supportId } = await seedTenant('Acme', 'fr')

      const forbidden = await graphqlRequest(
        repToken,
        `mutation CreateTask($input: CreateTaskInput!) {
          createTask(input: $input) { id }
        }`,
        { input: { title: 'Pushed onto a colleague', assignedTo: managerId } },
      )
      expect(forbidden.status).toBe(200)
      expect(forbidden.body.data.createTask).toBeNull()
      expect(forbidden.body.errors[0].message).toBe('Missing required permission: TASK:ASSIGN')

      const allowed = await graphqlRequest(
        managerToken,
        `mutation CreateTask($input: CreateTaskInput!) {
          createTask(input: $input) { id assignedTo }
        }`,
        { input: { title: 'Assigned by the manager', assignedTo: supportId } },
      )
      expect(allowed.body.errors).toBeUndefined()
      expect(allowed.body.data.createTask.assignedTo).toBe(supportId)
    })
  })

  // ─── assignTask (AC 32, AC 50, AC 91) ────────────────────────────────────

  describe('assignTask', () => {
    it('succeeds as SALES_MANAGER and is rejected for SALES_REP', async () => {
      const { repToken, managerToken, managerId, supportId } = await seedTenant('Acme', 'as')
      const task = await createTaskViaGraphql(repToken, { title: 'Assignment target' })

      const forbidden = await graphqlRequest(
        repToken,
        `mutation AssignTask($id: ID!, $assigneeId: ID!) {
          assignTask(id: $id, assigneeId: $assigneeId) { id assignedTo }
        }`,
        { id: task.id, assigneeId: managerId },
      )
      expect(forbidden.body.data.assignTask).toBeNull()
      expect(forbidden.body.errors[0].message).toBe('Missing required permission: TASK:ASSIGN')

      const allowed = await graphqlRequest(
        managerToken,
        `mutation AssignTask($id: ID!, $assigneeId: ID!) {
          assignTask(id: $id, assigneeId: $assigneeId) { id assignedTo }
        }`,
        { id: task.id, assigneeId: supportId },
      )
      expect(allowed.body.errors).toBeUndefined()
      expect(allowed.body.data.assignTask.id).toBe(task.id)
      expect(allowed.body.data.assignTask.assignedTo).toBe(supportId)
    })
  })

  // ─── myTasks / tasks (AC 48, AC 91) ──────────────────────────────────────

  describe('myTasks', () => {
    it('returns only the caller tasks', async () => {
      const { repToken, managerToken, managerId } = await seedTenant('Acme', 'my')

      const repTask = await createTaskViaGraphql(repToken, { title: 'Rep own task' })
      await createTaskViaGraphql(managerToken, {
        title: 'Manager own task',
        assignedTo: managerId,
      })

      const repResponse = await graphqlRequest(
        repToken,
        `query { myTasks(pagination: { page: 1, pageSize: 20 }) {
          total items { id title }
        } }`,
        {},
      )
      expect(repResponse.body.errors).toBeUndefined()
      expect(repResponse.body.data.myTasks.total).toBe(1)
      expect(repResponse.body.data.myTasks.items[0].id).toBe(repTask.id)

      // The list query applies the OWN visibility filter the same way.
      const listResponse = await graphqlRequest(
        repToken,
        `query { tasks(pagination: { page: 1, pageSize: 20 }) {
          total items { id title }
        } }`,
        {},
      )
      expect(listResponse.body.errors).toBeUndefined()
      expect(listResponse.body.data.tasks.total).toBe(1)
      expect(listResponse.body.data.tasks.items[0].id).toBe(repTask.id)

      const managerResponse = await graphqlRequest(
        managerToken,
        `query { myTasks(pagination: { page: 1, pageSize: 20 }) {
          total items { id }
        } }`,
        {},
      )
      expect(managerResponse.body.data.myTasks.total).toBe(1)
    })
  })

  // ─── createTaskFromTemplate (AC 40, AC 91) ───────────────────────────────

  describe('createTaskFromTemplate', () => {
    it('computes dueDate from defaultDueInDays and stamps template fields', async () => {
      const { repToken, repId } = await seedTenant('Acme', 'tmpl')

      const templateResponse = await graphqlRequest(
        repToken,
        `mutation CreateTaskTemplate($input: CreateTaskTemplateInput!) {
          createTaskTemplate(input: $input) {
            id name title defaultPriority defaultDueInDays
          }
        }`,
        {
          input: {
            name: 'Follow-up',
            title: 'Follow up with Acme',
            defaultPriority: 'HIGH',
            defaultDueInDays: 5,
          },
        },
      )
      expect(templateResponse.body.errors).toBeUndefined()
      const template = templateResponse.body.data.createTaskTemplate
      expect(template.name).toBe('Follow-up')
      expect(template.title).toBe('Follow up with Acme')
      expect(template.defaultPriority).toBe('HIGH')
      expect(template.defaultDueInDays).toBe(5)

      const readTemplate = await graphqlRequest(
        repToken,
        `query TaskTemplate($id: ID!) {
          taskTemplate(id: $id) { id name title defaultPriority defaultDueInDays }
        }`,
        { id: template.id },
      )
      expect(readTemplate.body.errors).toBeUndefined()
      expect(readTemplate.body.data.taskTemplate.id).toBe(template.id)

      const templatesList = await graphqlRequest(
        repToken,
        `query { taskTemplates(pagination: { page: 1, pageSize: 20 }) {
          total items { id }
        } }`,
        {},
      )
      expect(templatesList.body.data.taskTemplates.total).toBe(1)

      const createdResponse = await graphqlRequest(
        repToken,
        `mutation CreateTaskFromTemplate($input: CreateTaskFromTemplateInput!) {
          createTaskFromTemplate(input: $input) {
            id title status priority dueDate assignedTo
          }
        }`,
        { input: { templateId: template.id } },
      )
      expect(createdResponse.body.errors).toBeUndefined()
      const created = createdResponse.body.data.createTaskFromTemplate
      expect(created.title).toBe('Follow up with Acme')
      expect(created.status).toBe('TODO')
      expect(created.priority).toBe('HIGH')
      expect(created.assignedTo).toBe(repId)

      const now = new Date()
      const expectedDue = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 5),
      )
      expect(new Date(created.dueDate).getTime()).toBe(expectedDue.getTime())
    })
  })

  // ─── completeTask (AC 33, AC 91) ─────────────────────────────────────────

  describe('completeTask', () => {
    it('stamps completedAt and is idempotent', async () => {
      const { repToken } = await seedTenant('Acme', 'co')
      const task = await createTaskViaGraphql(repToken, { title: 'To complete' })

      const first = await graphqlRequest(
        repToken,
        `mutation CompleteTask($id: ID!) { completeTask(id: $id) { id status completedAt } }`,
        { id: task.id },
      )
      expect(first.body.errors).toBeUndefined()
      expect(first.body.data.completeTask.status).toBe('COMPLETED')
      expect(first.body.data.completeTask.completedAt).not.toBeNull()
      const firstStamp = first.body.data.completeTask.completedAt

      const second = await graphqlRequest(
        repToken,
        `mutation CompleteTask($id: ID!) { completeTask(id: $id) { id status completedAt } }`,
        { id: task.id },
      )
      expect(second.body.errors).toBeUndefined()
      expect(second.body.data.completeTask.status).toBe('COMPLETED')
      expect(second.body.data.completeTask.completedAt).toBe(firstStamp)
    })
  })

  // ─── deleteTask (AC 36, AC 91) ───────────────────────────────────────────

  describe('deleteTask', () => {
    it('soft-deletes: gone from tasks, row remains in the table', async () => {
      const { repToken, tenantId } = await seedTenant('Acme', 'dl')
      const task = await createTaskViaGraphql(repToken, { title: 'To delete' })

      const deleteResponse = await graphqlRequest(
        repToken,
        `mutation DeleteTask($id: ID!) { deleteTask(id: $id) }`,
        { id: task.id },
      )
      expect(deleteResponse.body.errors).toBeUndefined()
      expect(deleteResponse.body.data.deleteTask).toBe(true)

      const listResponse = await graphqlRequest(
        repToken,
        `query { tasks(pagination: { page: 1, pageSize: 20 }) { total items { id } } }`,
        {},
      )
      expect(listResponse.body.data.tasks.total).toBe(0)

      const row = await prisma.task.findUnique({ where: { id: task.id } })
      expect(row).not.toBeNull()
      expect(row?.deletedAt).not.toBeNull()
      expect(row?.tenantId).toBe(tenantId)
    })
  })

  // ─── Audit logging (AC 55, AC 91) ────────────────────────────────────────

  describe('audit logging', () => {
    it('writes an AuditLog row for createTask', async () => {
      const { repToken, repId, tenantId } = await seedTenant('Acme', 'au')
      const task = await createTaskViaGraphql(repToken, { title: 'Audited task' })

      const auditRow = await findAuditRow({
        tenantId,
        action: 'CREATE',
        entity: 'TASK',
      })
      expect(auditRow).not.toBeNull()
      expect(auditRow?.entityId).toBe(task.id)
      expect(auditRow?.userId).toBe(repId)
    })
  })

  // ─── Permission gates as non-ADMIN roles (AC 50, AC 91) ──────────────────

  describe('permission gates (non-ADMIN roles)', () => {
    it('SUPPORT_AGENT can read and update but not create, assign or delete', async () => {
      const { managerToken, supportToken, supportId, managerId } = await seedTenant('Acme', 'pg')

      // A task assigned to the support agent (created by the manager — the rep
      // lacks ASSIGN, so creating it via the rep is itself forbidden, AC 51).
      const supportTask = await graphqlRequest(
        managerToken,
        `mutation CreateTask($input: CreateTaskInput!) {
          createTask(input: $input) { id }
        }`,
        { input: { title: 'Support can touch this', assignedTo: supportId } },
      )
      expect(supportTask.body.errors).toBeUndefined()
      const taskId = supportTask.body.data.createTask.id

      const read = await graphqlRequest(
        supportToken,
        `query Task($id: ID!) { task(id: $id) { id title } }`,
        { id: taskId },
      )
      expect(read.body.errors).toBeUndefined()
      expect(read.body.data.task.id).toBe(taskId)

      const update = await graphqlRequest(
        supportToken,
        `mutation UpdateTask($id: ID!) {
          updateTask(id: $id, input: { status: IN_PROGRESS }) { id status }
        }`,
        { id: taskId },
      )
      expect(update.body.errors).toBeUndefined()
      expect(update.body.data.updateTask.status).toBe('IN_PROGRESS')

      const createForbidden = await graphqlRequest(
        supportToken,
        `mutation CreateTask($input: CreateTaskInput!) {
          createTask(input: $input) { id }
        }`,
        { input: { title: 'Nope' } },
      )
      expect(createForbidden.body.errors[0].message).toBe(
        'Missing required permission: TASK:CREATE',
      )

      const deleteForbidden = await graphqlRequest(
        supportToken,
        `mutation DeleteTask($id: ID!) { deleteTask(id: $id) }`,
        { id: taskId },
      )
      expect(deleteForbidden.body.errors[0].message).toBe(
        'Missing required permission: TASK:DELETE',
      )

      const assignForbidden = await graphqlRequest(
        supportToken,
        `mutation AssignTask($id: ID!, $assigneeId: ID!) {
          assignTask(id: $id, assigneeId: $assigneeId) { id }
        }`,
        { id: taskId, assigneeId: managerId },
      )
      expect(assignForbidden.body.errors[0].message).toBe(
        'Missing required permission: TASK:ASSIGN',
      )
    })

    it('template gates: CREATE/UPDATE/DELETE as non-ADMIN roles', async () => {
      const { repToken, supportToken } = await seedTenant('Acme', 'tp')

      // SUPPORT_AGENT cannot create templates.
      const createForbidden = await graphqlRequest(
        supportToken,
        `mutation CreateTaskTemplate($input: CreateTaskTemplateInput!) {
          createTaskTemplate(input: $input) { id }
        }`,
        { input: { name: 'Nope', title: 'Nope' } },
      )
      expect(createForbidden.body.errors[0].message).toBe(
        'Missing required permission: TASK:CREATE',
      )

      // SALES_REP can create (TASK:CREATE) and delete (TASK:DELETE) templates.
      const templateResponse = await graphqlRequest(
        repToken,
        `mutation CreateTaskTemplate($input: CreateTaskTemplateInput!) {
          createTaskTemplate(input: $input) { id name title }
        }`,
        { input: { name: 'Rep template', title: 'Rep task' } },
      )
      expect(templateResponse.body.errors).toBeUndefined()
      const templateId = templateResponse.body.data.createTaskTemplate.id

      // SUPPORT_AGENT can update (TASK:UPDATE) but not delete (TASK:DELETE).
      const updateOk = await graphqlRequest(
        supportToken,
        `mutation UpdateTaskTemplate($id: ID!) {
          updateTaskTemplate(id: $id, input: { name: "Renamed by support" }) {
            id name
          }
        }`,
        { id: templateId },
      )
      expect(updateOk.body.errors).toBeUndefined()
      expect(updateOk.body.data.updateTaskTemplate.name).toBe('Renamed by support')

      const deleteForbidden = await graphqlRequest(
        supportToken,
        `mutation DeleteTaskTemplate($id: ID!) { deleteTaskTemplate(id: $id) }`,
        { id: templateId },
      )
      expect(deleteForbidden.body.errors[0].message).toBe(
        'Missing required permission: TASK:DELETE',
      )

      const deleteOk = await graphqlRequest(
        repToken,
        `mutation DeleteTaskTemplate($id: ID!) { deleteTaskTemplate(id: $id) }`,
        { id: templateId },
      )
      expect(deleteOk.body.errors).toBeUndefined()
      expect(deleteOk.body.data.deleteTaskTemplate).toBe(true)
    })

    it('createTaskFromTemplate with a foreign assignedTo is rejected for SALES_REP (AC 51)', async () => {
      const { repToken, managerId } = await seedTenant('Acme', 'tpa')

      const templateResponse = await graphqlRequest(
        repToken,
        `mutation CreateTaskTemplate($input: CreateTaskTemplateInput!) {
          createTaskTemplate(input: $input) { id }
        }`,
        { input: { name: 'Assignment template', title: 'Template task' } },
      )
      expect(templateResponse.body.errors).toBeUndefined()
      const templateId = templateResponse.body.data.createTaskTemplate.id

      const forbidden = await graphqlRequest(
        repToken,
        `mutation CreateTaskFromTemplate($input: CreateTaskFromTemplateInput!) {
          createTaskFromTemplate(input: $input) { id }
        }`,
        { input: { templateId, assignedTo: managerId } },
      )
      expect(forbidden.body.data.createTaskFromTemplate).toBeNull()
      expect(forbidden.body.errors[0].message).toBe('Missing required permission: TASK:ASSIGN')
    })
  })
})
