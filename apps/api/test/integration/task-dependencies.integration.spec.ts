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

const DEPENDENCY_FIELDS = `
  dependencyId taskId status restricted title priority dueDate assigneeName
`

interface GraphQLResponse {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any
  errors?: Array<{ message: string }>
}

describe('Task dependencies and recurring tasks (integration)', () => {
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

  afterEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "TaskDependency", "Task", "TaskTemplate", "Deal", "DealStage", "Note", "Contact", "User", "UserRole", "Role", "Permission", "RolePermission", "Team", "Tenant", "AuditLog" RESTART IDENTITY CASCADE',
    )
  })

  // ─── Seeding helpers ──────────────────────────────────────────────────

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
        dataVisibility: dataVisibility as 'TEAM' | 'OWN' | 'ALL',
        isSystem: true,
      },
    })
    return role.id
  }

  async function seedPermissions(roleId: string): Promise<void> {
    const perms = ['CREATE', 'READ', 'UPDATE', 'DELETE', 'ASSIGN']
    for (const action of perms) {
      let perm = await prisma.permission.findUnique({
        where: { resource_action: { resource: 'TASK', action } },
      })
      if (!perm) {
        perm = await prisma.permission.create({
          data: { resource: 'TASK', action, description: `${action} tasks` },
        })
      }
      await prisma.rolePermission.create({ data: { roleId, permissionId: perm.id } })
    }
  }

  async function createUser(
    tenantId: string,
    roleId: string,
    email: string,
    firstName: string,
    lastName: string,
    roles: string[] = ['SALES_MANAGER'],
  ): Promise<{ userId: string; token: string }> {
    const user = await prisma.user.create({
      data: {
        tenantId,
        email,
        firstName,
        lastName,
        isActive: true,
      },
    })
    await prisma.userRole.create({ data: { userId: user.id, roleId } })

    const token = jwtService.sign({
      sub: user.id,
      userId: user.id,
      tenantId,
      email,
      roles,
    })

    return { userId: user.id, token }
  }

  async function createTask(
    tenantId: string,
    userId: string,
    title: string,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const task = await prisma.task.create({
      data: {
        tenantId,
        title,
        assignedTo: userId,
        ...overrides,
      },
    })
    return task.id
  }

  async function gql(
    token: string,
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<GraphQLResponse> {
    const res = await request(app.getHttpServer())
      .post('/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send({ query, variables })
    return res.body as GraphQLResponse
  }

  // ─── Test cases ───────────────────────────────────────────────────────

  describe('addTaskDependency / removeTaskDependency', () => {
    it('adds and removes a dependency via GraphQL', async () => {
      const tenant = await createTenant('Test Tenant')
      const roleId = await createRole(tenant.id, 'SALES_MANAGER', 'ALL')
      await seedPermissions(roleId)
      const { token } = await createUser(tenant.id, roleId, 'mgr@test.com', 'Manager', 'User')

      const taskId = await createTask(
        tenant.id,
        (await prisma.user.findFirst({ where: { tenantId: tenant.id } }))!.id,
        'Task A',
      )
      const blockerId = await createTask(
        tenant.id,
        (await prisma.user.findFirst({ where: { tenantId: tenant.id } }))!.id,
        'Task B',
      )

      // Add dependency: A blocked by B
      const addResult = await gql(
        token,
        `
        mutation AddDep($taskId: ID!, $depId: ID!) {
          addTaskDependency(taskId: $taskId, dependsOnTaskId: $depId) {
            blockedBy { ${DEPENDENCY_FIELDS} }
            blocking { ${DEPENDENCY_FIELDS} }
            isBlocked
            openBlockerCount
          }
        }
      `,
        { taskId, depId: blockerId },
      )

      expect(addResult.errors).toBeUndefined()
      expect(addResult.data.addTaskDependency.blockedBy).toHaveLength(1)
      expect(addResult.data.addTaskDependency.blockedBy[0].taskId).toBe(blockerId)
      expect(addResult.data.addTaskDependency.isBlocked).toBe(true)
      expect(addResult.data.addTaskDependency.openBlockerCount).toBe(1)

      // Query dependency view
      const viewResult = await gql(
        token,
        `
        query DepView($taskId: ID!) {
          taskDependencies(taskId: $taskId) {
            blockedBy { ${DEPENDENCY_FIELDS} }
            isBlocked
            openBlockerCount
          }
        }
      `,
        { taskId },
      )

      expect(viewResult.data.taskDependencies.blockedBy).toHaveLength(1)

      // Remove dependency
      const depId = addResult.data.addTaskDependency.blockedBy[0].dependencyId
      const removeResult = await gql(
        token,
        `
        mutation RemoveDep($depId: ID!) {
          removeTaskDependency(dependencyId: $depId) {
            blockedBy { ${DEPENDENCY_FIELDS} }
            isBlocked
          }
        }
      `,
        { depId },
      )

      expect(removeResult.errors).toBeUndefined()
      expect(removeResult.data.removeTaskDependency.blockedBy).toHaveLength(0)
      expect(removeResult.data.removeTaskDependency.isBlocked).toBe(false)
    })

    it('rejects self-edge', async () => {
      const tenant = await createTenant('Test Tenant')
      const roleId = await createRole(tenant.id, 'SALES_MANAGER', 'ALL')
      await seedPermissions(roleId)
      const { token } = await createUser(tenant.id, roleId, 'mgr@test.com', 'Manager', 'User')
      const taskId = await createTask(
        tenant.id,
        (await prisma.user.findFirst({ where: { tenantId: tenant.id } }))!.id,
        'Task A',
      )

      const result = await gql(
        token,
        `
        mutation AddDep($taskId: ID!, $depId: ID!) {
          addTaskDependency(taskId: $taskId, dependsOnTaskId: $depId) {
            isBlocked
          }
        }
      `,
        { taskId, depId: taskId },
      )

      expect(result.errors).toBeDefined()
      expect(result.errors?.[0]?.message).toContain('cannot depend on itself')
    })

    it('rejects cycle', async () => {
      const tenant = await createTenant('Test Tenant')
      const roleId = await createRole(tenant.id, 'SALES_MANAGER', 'ALL')
      await seedPermissions(roleId)
      const { token } = await createUser(tenant.id, roleId, 'mgr@test.com', 'Manager', 'User')
      const userId = (await prisma.user.findFirst({ where: { tenantId: tenant.id } }))!.id
      const taskA = await createTask(tenant.id, userId, 'Task A')
      const taskB = await createTask(tenant.id, userId, 'Task B')

      // Add A→B (A blocked by B)
      await gql(
        token,
        `
        mutation AddDep($taskId: ID!, $depId: ID!) {
          addTaskDependency(taskId: $taskId, dependsOnTaskId: $depId) { isBlocked }
        }
      `,
        { taskId: taskA, depId: taskB },
      )

      // Try to add B→A (would create cycle)
      const result = await gql(
        token,
        `
        mutation AddDep($taskId: ID!, $depId: ID!) {
          addTaskDependency(taskId: $taskId, dependsOnTaskId: $depId) { isBlocked }
        }
      `,
        { taskId: taskB, depId: taskA },
      )

      expect(result.errors).toBeDefined()
      expect(result.errors?.[0]?.message).toContain('cycle')
    })

    it('blocks completion when dependencies are open', async () => {
      const tenant = await createTenant('Test Tenant')
      const roleId = await createRole(tenant.id, 'SALES_MANAGER', 'ALL')
      await seedPermissions(roleId)
      const { token } = await createUser(tenant.id, roleId, 'mgr@test.com', 'Manager', 'User')
      const userId = (await prisma.user.findFirst({ where: { tenantId: tenant.id } }))!.id
      const taskA = await createTask(tenant.id, userId, 'Task A')
      const blocker = await createTask(tenant.id, userId, 'Blocker')

      // Add dependency: A blocked by blocker
      await gql(
        token,
        `
        mutation AddDep($taskId: ID!, $depId: ID!) {
          addTaskDependency(taskId: $taskId, dependsOnTaskId: $depId) { isBlocked }
        }
      `,
        { taskId: taskA, depId: blocker },
      )

      // Try to complete A
      const result = await gql(
        token,
        `
        mutation Complete($id: ID!) {
          completeTask(id: $id) { id status }
        }
      `,
        { id: taskA },
      )

      expect(result.errors).toBeDefined()
      expect(result.errors?.[0]?.message).toContain('Cannot complete')
    })

    it('allows completion after blocker is completed', async () => {
      const tenant = await createTenant('Test Tenant')
      const roleId = await createRole(tenant.id, 'SALES_MANAGER', 'ALL')
      await seedPermissions(roleId)
      const { token } = await createUser(tenant.id, roleId, 'mgr@test.com', 'Manager', 'User')
      const userId = (await prisma.user.findFirst({ where: { tenantId: tenant.id } }))!.id
      const taskA = await createTask(tenant.id, userId, 'Task A')
      const blocker = await createTask(tenant.id, userId, 'Blocker')

      // Add dependency
      await gql(
        token,
        `
        mutation AddDep($taskId: ID!, $depId: ID!) {
          addTaskDependency(taskId: $taskId, dependsOnTaskId: $depId) { isBlocked }
        }
      `,
        { taskId: taskA, depId: blocker },
      )

      // Complete blocker
      await gql(
        token,
        `
        mutation Complete($id: ID!) {
          completeTask(id: $id) { id status }
        }
      `,
        { id: blocker },
      )

      // Now complete A — should succeed
      const result = await gql(
        token,
        `
        mutation Complete($id: ID!) {
          completeTask(id: $id) { id status }
        }
      `,
        { id: taskA },
      )

      expect(result.errors).toBeUndefined()
      expect(result.data.completeTask.status).toBe('COMPLETED')
    })
  })

  describe('runRecurringTaskGeneration', () => {
    it('generates occurrences for a daily recurring task', async () => {
      const tenant = await createTenant('Test Tenant')
      // ADMIN role needed for the mutation
      const adminRoleId = await createRole(tenant.id, 'ADMIN', 'ALL')
      await seedPermissions(adminRoleId)
      const { token } = await createUser(
        tenant.id,
        adminRoleId,
        'admin@test.com',
        'Admin',
        'User',
        ['ADMIN'],
      )
      const userId = (await prisma.user.findFirst({ where: { tenantId: tenant.id } }))!.id

      // Create a recurring template
      const templateId = await createTask(tenant.id, userId, 'Daily standup', {
        isRecurring: true,
        recurrencePattern: 'DAILY',
        dueDate: new Date('2026-08-01T00:00:00.000Z'),
      })

      // Run the generation (today = Aug 4)
      const result = await gql(
        token,
        `
        mutation RunRecurrence {
          runRecurringTaskGeneration {
            generated
            templatesScanned
          }
        }
      `,
      )

      expect(result.errors).toBeUndefined()
      expect(result.data.runRecurringTaskGeneration.templatesScanned).toBe(1)
      expect(result.data.runRecurringTaskGeneration.generated).toBeGreaterThanOrEqual(1)

      // Verify occurrences exist in DB
      const occurrences = await prisma.task.findMany({
        where: { parentTaskId: templateId },
        orderBy: { dueDate: 'asc' },
      })
      expect(occurrences.length).toBeGreaterThanOrEqual(1)
      expect(occurrences[0].status).toBe('TODO')
      expect(occurrences[0].isRecurring).toBe(false)
    })

    it('is idempotent across two runs', async () => {
      const tenant = await createTenant('Test Tenant')
      const adminRoleId = await createRole(tenant.id, 'ADMIN', 'ALL')
      await seedPermissions(adminRoleId)
      const { token } = await createUser(
        tenant.id,
        adminRoleId,
        'admin@test.com',
        'Admin',
        'User',
        ['ADMIN'],
      )
      const userId = (await prisma.user.findFirst({ where: { tenantId: tenant.id } }))!.id

      await createTask(tenant.id, userId, 'Daily standup', {
        isRecurring: true,
        recurrencePattern: 'DAILY',
        dueDate: new Date('2026-08-01T00:00:00.000Z'),
      })

      // Run twice
      await gql(token, `mutation { runRecurringTaskGeneration { generated } }`)
      const second = await gql(token, `mutation { runRecurringTaskGeneration { generated } }`)

      // Second run should generate 0 (already exists)
      expect(second.data.runRecurringTaskGeneration.generated).toBe(0)
    })

    it('completing an occurrence does not affect the template', async () => {
      const tenant = await createTenant('Test Tenant')
      const adminRoleId = await createRole(tenant.id, 'ADMIN', 'ALL')
      await seedPermissions(adminRoleId)
      const { token } = await createUser(
        tenant.id,
        adminRoleId,
        'admin@test.com',
        'Admin',
        'User',
        ['ADMIN'],
      )
      const userId = (await prisma.user.findFirst({ where: { tenantId: tenant.id } }))!.id

      const templateId = await createTask(tenant.id, userId, 'Daily standup', {
        isRecurring: true,
        recurrencePattern: 'DAILY',
        dueDate: new Date('2026-08-01T00:00:00.000Z'),
      })

      // Generate occurrences
      await gql(token, `mutation { runRecurringTaskGeneration { generated } }`)

      // Get one occurrence
      const occurrence = await prisma.task.findFirst({
        where: { parentTaskId: templateId },
        orderBy: { dueDate: 'asc' },
      })
      expect(occurrence).not.toBeNull()

      // Complete the occurrence
      await gql(
        token,
        `
        mutation Complete($id: ID!) {
          completeTask(id: $id) { id status }
        }
      `,
        { id: occurrence!.id },
      )

      // Template should still be isRecurring
      const template = await prisma.task.findUnique({ where: { id: templateId } })
      expect(template!.isRecurring).toBe(true)
      expect(template!.status).toBe('TODO')
    })
  })
})
