import { execFileSync } from 'child_process'
import * as path from 'path'

import { INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { JwtService } from '@nestjs/jwt'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { PostgreSqlContainer } from '@testcontainers/postgresql'

import { AppModule } from '../../src/app.module'

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'

const RESOURCES = [
  'CONTACT',
  'DEAL',
  'TASK',
  'TICKET',
  'REPORT',
  'USER',
  'ROLE',
  'SETTINGS',
] as const
const ACTIONS = ['CREATE', 'READ', 'UPDATE', 'DELETE', 'EXPORT', 'IMPORT', 'ASSIGN'] as const

describe('Permissions (integration)', () => {
  let prisma: PrismaClient
  let container: StartedPostgreSqlContainer
  let app: INestApplication
  let jwtService: JwtService

  let tenantAId: string
  let tenantBId: string
  let adminAToken: string
  let salesRepAToken: string
  let salesRepAId: string

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

    // Seed tenants
    const tenantA = await prisma.tenant.create({ data: { name: 'Tenant A' } })
    const tenantB = await prisma.tenant.create({ data: { name: 'Tenant B' } })
    tenantAId = tenantA.id
    tenantBId = tenantB.id

    // Seed global permissions (56 resource-action combinations)
    const permData = []
    for (const resource of RESOURCES) {
      for (const action of ACTIONS) {
        permData.push({ resource, action, description: `${action} ${resource.toLowerCase()}` })
      }
    }
    await prisma.permission.createMany({ data: permData, skipDuplicates: true })
    const allPerms = await prisma.permission.findMany()

    // Seed system roles for tenant A
    const roleData = [
      { name: 'ADMIN', description: 'Full system access' },
      { name: 'SALES_MANAGER', description: 'Sales team manager' },
      { name: 'SALES_REP', description: 'Sales representative' },
      { name: 'SUPPORT_AGENT', description: 'Customer support agent' },
      { name: 'MARKETING_USER', description: 'Marketing team member' },
    ]
    const roleIds: Record<string, string> = {}
    for (const r of roleData) {
      const role = await prisma.role.create({
        data: {
          tenantId: tenantAId,
          name: r.name,
          description: r.description,
          isSystem: true,
          createdBy: 'test',
          updatedBy: 'test',
        },
      })
      roleIds[r.name] = role.id
    }

    // Also seed roles for tenant B
    const roleIdsB: Record<string, string> = {}
    for (const r of roleData) {
      const role = await prisma.role.create({
        data: {
          tenantId: tenantBId,
          name: r.name,
          description: r.description,
          isSystem: true,
          createdBy: 'test',
          updatedBy: 'test',
        },
      })
      roleIdsB[r.name] = role.id
    }

    // Assign default permissions to roles in tenant A
    // SALES_REP gets CONTACT: CRUD, DEAL: CRUD, TASK: CRUD, REPORT: READ
    const salesRepPerms = allPerms.filter(
      (p) =>
        (p.resource === 'CONTACT' && ['CREATE', 'READ', 'UPDATE', 'DELETE'].includes(p.action)) ||
        (p.resource === 'DEAL' && ['CREATE', 'READ', 'UPDATE', 'DELETE'].includes(p.action)) ||
        (p.resource === 'TASK' && ['CREATE', 'READ', 'UPDATE', 'DELETE'].includes(p.action)) ||
        (p.resource === 'REPORT' && p.action === 'READ'),
    )
    await prisma.rolePermission.createMany({
      data: salesRepPerms.map((p) => ({ roleId: roleIds['SALES_REP'], permissionId: p.id })),
    })

    // Sales Manager gets CONTACT: all except DELETE etc.
    const salesManagerPerms = allPerms.filter(
      (p) =>
        p.resource === 'CONTACT' ||
        (p.resource === 'DEAL' && p.action !== 'DELETE') ||
        (p.resource === 'TASK' && !['EXPORT', 'IMPORT'].includes(p.action)) ||
        (p.resource === 'REPORT' && ['READ', 'EXPORT'].includes(p.action)) ||
        (p.resource === 'USER' && p.action === 'READ'),
    )
    await prisma.rolePermission.createMany({
      data: salesManagerPerms.map((p) => ({
        roleId: roleIds['SALES_MANAGER'],
        permissionId: p.id,
      })),
    })

    // Create users
    const adminA = await prisma.user.create({
      data: {
        tenantId: tenantAId,
        email: 'admin-a@test.com',
        firstName: 'Admin',
        lastName: 'A',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    const salesRepA = await prisma.user.create({
      data: {
        tenantId: tenantAId,
        email: 'sales-a@test.com',
        firstName: 'Sales',
        lastName: 'A',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    salesRepAId = salesRepA.id

    // Assign roles
    await prisma.userRole.create({
      data: { userId: adminA.id, roleId: roleIds['ADMIN'], assignedBy: 'test' },
    })
    await prisma.userRole.create({
      data: { userId: salesRepA.id, roleId: roleIds['SALES_REP'], assignedBy: 'test' },
    })

    adminAToken = jwtService.sign({
      sub: adminA.id,
      userId: adminA.id,
      tenantId: tenantAId,
      roles: ['ADMIN'],
      email: 'admin-a@test.com',
    })
    salesRepAToken = jwtService.sign({
      sub: salesRepA.id,
      userId: salesRepA.id,
      tenantId: tenantAId,
      roles: ['SALES_REP'],
      email: 'sales-a@test.com',
    })
  }, 120_000)

  afterAll(async () => {
    await app.close()
    await prisma.$disconnect()
    await container.stop()
  })

  async function graphqlRequest(
    token: string,
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<request.Response> {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send({ query, variables })
  }

  describe('allPermissions query', () => {
    it('returns all 56 permissions', async () => {
      const query = `query { allPermissions { id resource action description } }`
      const res = await graphqlRequest(adminAToken, query)
      expect(res.status).toBe(200)
      expect(res.body.data.allPermissions).toHaveLength(56)
    })

    it('any authenticated user can query allPermissions', async () => {
      const query = `query { allPermissions { id resource action } }`
      const res = await graphqlRequest(salesRepAToken, query)
      expect(res.status).toBe(200)
      expect(res.body.data.allPermissions).toHaveLength(56)
    })
  })

  describe('rolePermissions query', () => {
    it('returns permissions for a specific role', async () => {
      const salesRepRole = await prisma.role.findFirst({
        where: { tenantId: tenantAId, name: 'SALES_REP' },
      })
      const query = `query RolePermissions($roleId: ID!) { rolePermissions(roleId: $roleId) { id resource action } }`
      const res = await graphqlRequest(adminAToken, query, { roleId: salesRepRole!.id })
      expect(res.status).toBe(200)
      const perms = res.body.data.rolePermissions
      expect(perms.length).toBeGreaterThan(0)
      // SALES_REP should have CONTACT:READ
      expect(
        perms.some(
          (p: { resource: string; action: string }) =>
            p.resource === 'CONTACT' && p.action === 'READ',
        ),
      ).toBe(true)
    })

    it('returns empty for role with no permissions', async () => {
      const marketingRole = await prisma.role.findFirst({
        where: { tenantId: tenantAId, name: 'MARKETING_USER' },
      })
      const query = `query RolePermissions($roleId: ID!) { rolePermissions(roleId: $roleId) { id resource action } }`
      const res = await graphqlRequest(adminAToken, query, { roleId: marketingRole!.id })
      expect(res.status).toBe(200)
      expect(res.body.data.rolePermissions).toHaveLength(0)
    })
  })

  describe('myPermissions query', () => {
    it('returns permission catalog with granted flags for current user', async () => {
      const query = `query { myPermissions { resource action granted } }`
      const res = await graphqlRequest(salesRepAToken, query)
      expect(res.status).toBe(200)
      const perms = res.body.data.myPermissions
      expect(perms.length).toBe(56)
      const contactRead = perms.find(
        (p: { resource: string; action: string }) =>
          p.resource === 'CONTACT' && p.action === 'READ',
      )
      expect(contactRead.granted).toBe(true)
      const userDelete = perms.find(
        (p: { resource: string; action: string }) => p.resource === 'USER' && p.action === 'DELETE',
      )
      expect(userDelete.granted).toBe(false)
    })
  })

  describe('assignPermissionToRole', () => {
    it('assigns and then removes permission', async () => {
      const marketingRole = await prisma.role.findFirst({
        where: { tenantId: tenantAId, name: 'MARKETING_USER' },
      })
      const readContactPerm = await prisma.permission.findUnique({
        where: { resource_action: { resource: 'CONTACT', action: 'READ' } },
      })

      // Assign
      const assignMutation = `mutation Assign($roleId: ID!, $permissionId: ID!) { assignPermissionToRole(roleId: $roleId, permissionId: $permissionId) { id } }`
      const assignRes = await graphqlRequest(adminAToken, assignMutation, {
        roleId: marketingRole!.id,
        permissionId: readContactPerm!.id,
      })
      expect(assignRes.status).toBe(200)
      expect(assignRes.body.data.assignPermissionToRole.id).toBe(readContactPerm!.id)

      // Verify
      const query = `query RolePermissions($roleId: ID!) { rolePermissions(roleId: $roleId) { id } }`
      const queryRes = await graphqlRequest(adminAToken, query, { roleId: marketingRole!.id })
      expect(queryRes.body.data.rolePermissions).toHaveLength(1)

      // Remove
      const removeMutation = `mutation Remove($roleId: ID!, $permissionId: ID!) { removePermissionFromRole(roleId: $roleId, permissionId: $permissionId) }`
      const removeRes = await graphqlRequest(adminAToken, removeMutation, {
        roleId: marketingRole!.id,
        permissionId: readContactPerm!.id,
      })
      expect(removeRes.body.data.removePermissionFromRole).toBe(true)

      // Verify removed
      const queryRes2 = await graphqlRequest(adminAToken, query, { roleId: marketingRole!.id })
      expect(queryRes2.body.data.rolePermissions).toHaveLength(0)
    })

    it('non-admin user cannot assign permissions', async () => {
      const marketingRole = await prisma.role.findFirst({
        where: { tenantId: tenantAId, name: 'MARKETING_USER' },
      })
      const perm = await prisma.permission.findUnique({
        where: { resource_action: { resource: 'CONTACT', action: 'READ' } },
      })
      const mutation = `mutation Assign($roleId: ID!, $permissionId: ID!) { assignPermissionToRole(roleId: $roleId, permissionId: $permissionId) { id } }`
      const res = await graphqlRequest(salesRepAToken, mutation, {
        roleId: marketingRole!.id,
        permissionId: perm!.id,
      })
      expect(res.body.errors).toBeDefined()
      expect(res.body.errors[0].message).toContain('Only admins')
    })
  })

  describe('setRolePermissions', () => {
    it('bulk replaces permissions for a role', async () => {
      const marketingRole = await prisma.role.findFirst({
        where: { tenantId: tenantAId, name: 'MARKETING_USER' },
      })
      const perms = await prisma.permission.findMany({
        where: {
          OR: [
            { resource: 'CONTACT', action: 'READ' },
            { resource: 'REPORT', action: 'READ' },
            { resource: 'REPORT', action: 'EXPORT' },
          ],
        },
      })

      const mutation = `mutation Set($roleId: ID!, $permissionIds: [ID!]!) { setRolePermissions(roleId: $roleId, permissionIds: $permissionIds) { id } }`
      const res = await graphqlRequest(adminAToken, mutation, {
        roleId: marketingRole!.id,
        permissionIds: perms.map((p) => p.id),
      })
      expect(res.status).toBe(200)
      expect(res.body.data.setRolePermissions).toHaveLength(3)

      // Verify persisted
      const verifyRes = await graphqlRequest(
        adminAToken,
        `query RolePerms($roleId: ID!) { rolePermissions(roleId: $roleId) { id } }`,
        { roleId: marketingRole!.id },
      )
      expect(verifyRes.body.data.rolePermissions).toHaveLength(3)
    })
  })

  describe('permission enforcement on contacts', () => {
    it('user with CONTACT:CREATE can create contacts', async () => {
      const mutation = `mutation CreateContact($input: CreateContactInput!) { createContact(input: $input) { id email } }`
      const res = await graphqlRequest(salesRepAToken, mutation, {
        input: { email: 'test@perm.com', firstName: 'Test', lastName: 'Perm' },
      })
      expect(res.status).toBe(200)
      expect(res.body.data.createContact.email).toBe('test@perm.com')
    })

    it('user without CONTACT:CREATE gets 403', async () => {
      // Create a user with only REPORT:READ permission
      const reportOnlyRole = await prisma.role.create({
        data: {
          tenantId: tenantAId,
          name: 'ReportOnly',
          isSystem: false,
          createdBy: 'test',
          updatedBy: 'test',
        },
      })
      const reportReadPerm = await prisma.permission.findUnique({
        where: { resource_action: { resource: 'REPORT', action: 'READ' } },
      })
      await prisma.rolePermission.create({
        data: { roleId: reportOnlyRole.id, permissionId: reportReadPerm!.id },
      })

      const reportUser = await prisma.user.create({
        data: {
          tenantId: tenantAId,
          email: 'report@test.com',
          firstName: 'Report',
          lastName: 'User',
          createdBy: 'test',
          updatedBy: 'test',
        },
      })
      await prisma.userRole.create({
        data: { userId: reportUser.id, roleId: reportOnlyRole.id, assignedBy: 'test' },
      })

      const token = jwtService.sign({
        sub: reportUser.id,
        userId: reportUser.id,
        tenantId: tenantAId,
        roles: ['ReportOnly'],
        email: 'report@test.com',
      })

      const mutation = `mutation CreateContact($input: CreateContactInput!) { createContact(input: $input) { id } }`
      const res = await graphqlRequest(token, mutation, {
        input: { email: 'forbidden@perm.com', firstName: 'No', lastName: 'Perm' },
      })
      expect(res.body.errors).toBeDefined()
      expect(res.body.errors[0].message).toContain('Missing required permission')
    })

    it('ADMIN bypass: admin can create contacts without explicit permissions', async () => {
      const mutation = `mutation CreateContact($input: CreateContactInput!) { createContact(input: $input) { id email } }`
      const res = await graphqlRequest(adminAToken, mutation, {
        input: { email: 'admin-bypass@perm.com', firstName: 'Admin', lastName: 'Bypass' },
      })
      expect(res.status).toBe(200)
      expect(res.body.data.createContact.email).toBe('admin-bypass@perm.com')
    })
  })

  describe('permission enforcement on roles', () => {
    it('non-admin without ROLE:CREATE gets 403', async () => {
      const mutation = `mutation CreateRole($input: CreateRoleInput!) { createRole(input: $input) { id name } }`
      const res = await graphqlRequest(salesRepAToken, mutation, {
        input: { name: 'Should Fail' },
      })
      // requirePermission('ROLE', 'CREATE') runs first, then requireAdmin — both fail for non-admin
      // But requirePermission checks ADMIN bypass which they don't have, then does DB check against SALES_REP permissions
      // SALES_REP doesn't have ROLE:CREATE, so requirePermission throws 403 first
      expect(res.body.errors).toBeDefined()
    })
  })

  describe('cross-tenant isolation', () => {
    it('tenant A cannot assign permissions to tenant B role', async () => {
      const tenantBRole = await prisma.role.findFirst({
        where: { tenantId: tenantBId, name: 'MARKETING_USER' },
      })
      const perm = await prisma.permission.findUnique({
        where: { resource_action: { resource: 'CONTACT', action: 'READ' } },
      })

      const mutation = `mutation Assign($roleId: ID!, $permissionId: ID!) { assignPermissionToRole(roleId: $roleId, permissionId: $permissionId) { id } }`
      const res = await graphqlRequest(adminAToken, mutation, {
        roleId: tenantBRole!.id,
        permissionId: perm!.id,
      })
      expect(res.body.errors).toBeDefined()
      expect(res.body.errors[0].message).toContain('Role not found')
    })
  })

  describe('hasPermission service method', () => {
    it('returns true when user has permission via assigned role', async () => {
      const PermissionsService = app.get('PermissionsService' as never) as {
        hasPermission: (userId: string, resource: string, action: string) => Promise<boolean>
      }

      const result = await PermissionsService.hasPermission(salesRepAId, 'CONTACT', 'READ')
      expect(result).toBe(true)
    })

    it('returns false when user lacks permission', async () => {
      const PermissionsService = app.get('PermissionsService' as never) as {
        hasPermission: (userId: string, resource: string, action: string) => Promise<boolean>
      }

      const result = await PermissionsService.hasPermission(salesRepAId, 'ROLE', 'DELETE')
      expect(result).toBe(false)
    })
  })
})
