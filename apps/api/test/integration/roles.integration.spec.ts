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

describe('Roles RBAC (integration)', () => {
  let prisma: PrismaClient
  let container: StartedPostgreSqlContainer
  let app: INestApplication
  let jwtService: JwtService

  let tenantAId: string
  let tenantBId: string
  let adminAToken: string
  let userAToken: string
  let adminBToken: string
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

    // Seed system roles for both tenants
    const roleNames = ['ADMIN', 'SALES_MANAGER', 'SALES_REP', 'SUPPORT_AGENT', 'MARKETING_USER']
    for (const name of roleNames) {
      await prisma.role.createMany({
        data: [
          { tenantId: tenantAId, name, isSystem: true, createdBy: 'test', updatedBy: 'test' },
          { tenantId: tenantBId, name, isSystem: true, createdBy: 'test', updatedBy: 'test' },
        ],
      })
    }

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
    const userA = await prisma.user.create({
      data: {
        tenantId: tenantAId,
        email: 'user-a@test.com',
        firstName: 'User',
        lastName: 'A',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    const adminB = await prisma.user.create({
      data: {
        tenantId: tenantBId,
        email: 'admin-b@test.com',
        firstName: 'Admin',
        lastName: 'B',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })

    // Assign roles
    const adminARole = await prisma.role.findFirst({
      where: { tenantId: tenantAId, name: 'ADMIN' },
    })
    const salesRepARole = await prisma.role.findFirst({
      where: { tenantId: tenantAId, name: 'SALES_REP' },
    })
    const adminBRole = await prisma.role.findFirst({
      where: { tenantId: tenantBId, name: 'ADMIN' },
    })

    await prisma.userRole.create({
      data: { userId: adminA.id, roleId: adminARole!.id, assignedBy: 'test' },
    })
    await prisma.userRole.create({
      data: { userId: userA.id, roleId: salesRepARole!.id, assignedBy: 'test' },
    })
    await prisma.userRole.create({
      data: { userId: adminB.id, roleId: adminBRole!.id, assignedBy: 'test' },
    })

    adminAToken = jwtService.sign({
      sub: adminA.id,
      userId: adminA.id,
      tenantId: tenantAId,
      roles: ['ADMIN'],
      email: 'admin-a@test.com',
    })
    userAToken = jwtService.sign({
      sub: userA.id,
      userId: userA.id,
      tenantId: tenantAId,
      roles: ['SALES_REP'],
      email: 'user-a@test.com',
    })
    adminBToken = jwtService.sign({
      sub: adminB.id,
      userId: adminB.id,
      tenantId: tenantBId,
      roles: ['ADMIN'],
      email: 'admin-b@test.com',
    })
    void adminBToken
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

  describe('roles query', () => {
    it('returns roles for the authenticated tenant', async () => {
      const query = `query { roles { id name isSystem userCount } }`
      const res = await graphqlRequest(adminAToken, query)
      expect(res.status).toBe(200)
      expect(res.body.data.roles).toHaveLength(5)
      expect(res.body.data.roles.map((r: { name: string }) => r.name).sort()).toEqual([
        'ADMIN',
        'MARKETING_USER',
        'SALES_MANAGER',
        'SALES_REP',
        'SUPPORT_AGENT',
      ])
    })

    it('cross-tenant isolation: tenant A admin cannot see tenant B roles', async () => {
      const query = `query { roles { id name } }`
      const res = await graphqlRequest(adminAToken, query)
      const names = res.body.data.roles.map((r: { name: string }) => r.name)
      // Verify we only see tenant A's roles (5 system roles), not 10 (both tenants)
      expect(names).toHaveLength(5)
    })
  })

  describe('createRole', () => {
    it('creates a custom role for admin', async () => {
      const mutation = `mutation CreateRole($input: CreateRoleInput!) { createRole(input: $input) { id name description isSystem userCount } }`
      const res = await graphqlRequest(adminAToken, mutation, {
        input: { name: 'Custom Viewer', description: 'View only' },
      })
      expect(res.status).toBe(200)
      expect(res.body.data.createRole.name).toBe('Custom Viewer')
      expect(res.body.data.createRole.isSystem).toBe(false)
      expect(res.body.data.createRole.userCount).toBe(0)
    })

    it('rejects role creation for non-admin user', async () => {
      const mutation = `mutation CreateRole($input: CreateRoleInput!) { createRole(input: $input) { id name } }`
      const res = await graphqlRequest(userAToken, mutation, { input: { name: 'Should Fail' } })
      expect(res.body.errors).toBeDefined()
      expect(res.body.errors[0].message).toContain('Only admins')
    })

    it('rejects duplicate role name in same tenant', async () => {
      const mutation = `mutation CreateRole($input: CreateRoleInput!) { createRole(input: $input) { id name } }`
      await graphqlRequest(adminAToken, mutation, { input: { name: 'DuplicateRole' } })
      const res = await graphqlRequest(adminAToken, mutation, { input: { name: 'DuplicateRole' } })
      expect(res.body.errors).toBeDefined()
      expect(res.body.errors[0].message).toContain('already exists')
    })
  })

  describe('deleteRole', () => {
    it('rejects deletion of system role', async () => {
      const salesRep = await prisma.role.findFirst({
        where: { tenantId: tenantAId, name: 'SALES_REP' },
      })
      const mutation = `mutation DeleteRole($id: ID!) { deleteRole(id: $id) }`
      const res = await graphqlRequest(adminAToken, mutation, { id: salesRep!.id })
      expect(res.body.errors).toBeDefined()
      expect(res.body.errors[0].message).toContain('System roles cannot be deleted')
    })

    it('deletes a custom role', async () => {
      const custom = await prisma.role.create({
        data: {
          tenantId: tenantAId,
          name: 'ToDelete',
          isSystem: false,
          createdBy: 'test',
          updatedBy: 'test',
        },
      })
      const mutation = `mutation DeleteRole($id: ID!) { deleteRole(id: $id) }`
      const res = await graphqlRequest(adminAToken, mutation, { id: custom.id })
      expect(res.status).toBe(200)
      expect(res.body.data.deleteRole).toBe(true)
      // Verify soft delete
      const deleted = await prisma.role.findFirst({ where: { id: custom.id } })
      expect(deleted?.deletedAt).toBeTruthy()
    })
  })

  describe('assignRoleToUser', () => {
    it('assigns a role to a user and verifies cross-tenant rejection', async () => {
      const userA = await prisma.user.findFirst({
        where: { tenantId: tenantAId, email: 'user-a@test.com' },
      })
      const supportAgentRole = await prisma.role.findFirst({
        where: { tenantId: tenantAId, name: 'SUPPORT_AGENT' },
      })

      const mutation = `mutation AssignRole($userId: ID!, $roleId: ID!) { assignRoleToUser(userId: $userId, roleId: $roleId) { id name } }`
      const res = await graphqlRequest(adminAToken, mutation, {
        userId: userA!.id,
        roleId: supportAgentRole!.id,
      })
      expect(res.status).toBe(200)
      expect(res.body.data.assignRoleToUser.name).toBe('SUPPORT_AGENT')
    })

    it('rejects assignment when user and role are in different tenants', async () => {
      const userA = await prisma.user.findFirst({
        where: { tenantId: tenantAId, email: 'user-a@test.com' },
      })
      const adminBRole = await prisma.role.findFirst({
        where: { tenantId: tenantBId, name: 'ADMIN' },
      })

      const mutation = `mutation AssignRole($userId: ID!, $roleId: ID!) { assignRoleToUser(userId: $userId, roleId: $roleId) { id name } }`
      const res = await graphqlRequest(adminAToken, mutation, {
        userId: userA!.id,
        roleId: adminBRole!.id,
      })
      expect(res.body.errors).toBeDefined()
    })
  })

  describe('removeRoleFromUser', () => {
    it('removes a non-system role from a user', async () => {
      const userA = await prisma.user.findFirst({
        where: { tenantId: tenantAId, email: 'user-a@test.com' },
      })
      const customRole = await prisma.role.create({
        data: {
          tenantId: tenantAId,
          name: 'TempRole',
          isSystem: false,
          createdBy: 'test',
          updatedBy: 'test',
        },
      })
      await prisma.userRole.create({
        data: { userId: userA!.id, roleId: customRole.id, assignedBy: 'test' },
      })

      const mutation = `mutation RemoveRole($userId: ID!, $roleId: ID!) { removeRoleFromUser(userId: $userId, roleId: $roleId) }`
      const res = await graphqlRequest(adminAToken, mutation, {
        userId: userA!.id,
        roleId: customRole.id,
      })
      expect(res.status).toBe(200)
      expect(res.body.data.removeRoleFromUser).toBe(true)
    })
  })
})
