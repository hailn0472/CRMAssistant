import { execFileSync } from 'child_process'
import * as path from 'path'

import { INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { JwtService } from '@nestjs/jwt'
import { PrismaClient } from '@prisma/client'
import request, { type Test as SuperTest } from 'supertest'
import { PostgreSqlContainer } from '@testcontainers/postgresql'

import { AppModule } from '../../src/app.module'

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'

const JWT_SECRET = 'test-jwt-secret-with-enough-length-for-hs256'

describe('Data Visibility (integration)', () => {
  let prisma: PrismaClient
  let container: StartedPostgreSqlContainer
  let app: INestApplication
  let jwtService: JwtService

  let tenantAId: string
  let userAId: string // OWN role (SALES_REP), in Team1
  let userBId: string // TEAM role (SALES_MANAGER), in Team1
  let userCId: string // ADMIN role

  let team1Id: string
  let salesRepRoleId: string
  let salesManagerRoleId: string
  let adminRoleId: string

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:15-alpine').start()

    const databaseUrl = container.getConnectionUri()
    process.env['DATABASE_URL'] = databaseUrl
    process.env['JWT_SECRET'] = JWT_SECRET
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
    jwtService = app.get(JwtService)

    // Seed DATA:VIEW_ALL permission
    await prisma.permission.upsert({
      where: { resource_action: { resource: 'DATA', action: 'VIEW_ALL' } },
      create: { resource: 'DATA', action: 'VIEW_ALL', description: 'View all data' },
      update: {},
    })

    // Seed tenant A
    const tenantA = await prisma.tenant.create({ data: { name: 'Tenant A Vis' } })
    tenantAId = tenantA.id

    // Seed tenant B for cross-tenant isolation
    const tenantB = await prisma.tenant.create({ data: { name: 'Tenant B Vis' } })

    // Create roles with dataVisibility
    const adminRole = await prisma.role.create({
      data: {
        tenantId: tenantAId,
        name: 'ADMIN',
        description: 'Full access',
        isSystem: true,
        dataVisibility: 'ALL',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    const salesManager = await prisma.role.create({
      data: {
        tenantId: tenantAId,
        name: 'SALES_MANAGER',
        description: 'Team manager',
        isSystem: true,
        dataVisibility: 'TEAM',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    const salesRep = await prisma.role.create({
      data: {
        tenantId: tenantAId,
        name: 'SALES_REP',
        description: 'Sales rep',
        isSystem: true,
        dataVisibility: 'OWN',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    adminRoleId = adminRole.id
    salesManagerRoleId = salesManager.id
    salesRepRoleId = salesRep.id

    // Create team
    const team1 = await prisma.team.create({
      data: { tenantId: tenantAId, name: 'Team Alpha', createdBy: 'test', updatedBy: 'test' },
    })
    team1Id = team1.id

    // Create users
    const userA = await prisma.user.create({
      data: {
        tenantId: tenantAId,
        email: 'usera@test.com',
        firstName: 'User',
        lastName: 'A',
        teamId: team1Id,
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    const userB = await prisma.user.create({
      data: {
        tenantId: tenantAId,
        email: 'userb@test.com',
        firstName: 'User',
        lastName: 'B',
        teamId: team1Id,
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    const userC = await prisma.user.create({
      data: {
        tenantId: tenantAId,
        email: 'userc@test.com',
        firstName: 'User',
        lastName: 'C',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    userAId = userA.id
    userBId = userB.id
    userCId = userC.id

    // User in tenant B for cross-tenant test
    const userB2 = await prisma.user.create({
      data: {
        tenantId: tenantB.id,
        email: 'userb2@test.com',
        firstName: 'Tenant',
        lastName: 'B',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })

    // Assign roles
    await prisma.userRole.create({
      data: { userId: userAId, roleId: salesRepRoleId, assignedBy: 'test' },
    })
    await prisma.userRole.create({
      data: { userId: userBId, roleId: salesManagerRoleId, assignedBy: 'test' },
    })
    await prisma.userRole.create({
      data: { userId: userCId, roleId: adminRoleId, assignedBy: 'test' },
    })

    // Create contacts
    await prisma.contact.create({
      data: {
        tenantId: tenantAId,
        email: 'contact-a@test.com',
        firstName: 'A',
        lastName: 'Contact',
        ownerId: userAId,
        createdBy: userAId,
        updatedBy: userAId,
      },
    })
    await prisma.contact.create({
      data: {
        tenantId: tenantAId,
        email: 'contact-b@test.com',
        firstName: 'B',
        lastName: 'Contact',
        ownerId: userBId,
        createdBy: userBId,
        updatedBy: userBId,
      },
    })
    await prisma.contact.create({
      data: {
        tenantId: tenantAId,
        email: 'contact-c@test.com',
        firstName: 'C',
        lastName: 'Contact',
        ownerId: userCId,
        createdBy: userCId,
        updatedBy: userCId,
      },
    })
    // Contact in tenant B
    await prisma.contact.create({
      data: {
        tenantId: tenantB.id,
        email: 'contact-b2@test.com',
        firstName: 'B2',
        lastName: 'Contact',
        ownerId: userB2.id,
        createdBy: userB2.id,
        updatedBy: userB2.id,
      },
    })
  }, 120_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    await app?.close()
    await container?.stop()
  })

  function signToken(userId: string, roles: string[]): string {
    return jwtService.sign({
      sub: userId,
      userId,
      tenantId: tenantAId,
      roles,
      email: 'test@test.com',
    })
  }

  function graphqlQuery(
    token: string,
    query: string,
    variables?: Record<string, unknown>,
  ): SuperTest {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send({ query, variables })
  }

  // ─────────────────────────────────────────────────────────────────────────
  // OWN visibility
  // ─────────────────────────────────────────────────────────────────────────
  describe('OWN visibility', () => {
    it('user with OWN role sees only own contacts', async () => {
      const token = signToken(userAId, ['SALES_REP'])
      const res = await graphqlQuery(
        token,
        `
        query { contacts { items { email } } }
      `,
      )
      const emails = res.body.data.contacts.items.map((i: { email: string }) => i.email)
      expect(emails).toContain('contact-a@test.com')
      expect(emails).not.toContain('contact-b@test.com')
      expect(emails).not.toContain('contact-c@test.com')
    })

    it("user with OWN role gets 404 viewing another user's contact", async () => {
      const token = signToken(userAId, ['SALES_REP'])
      const contacts = await prisma.contact.findMany({
        where: { tenantId: tenantAId, email: 'contact-b@test.com' },
      })
      const res = await graphqlQuery(
        token,
        `
        query Contact($id: ID!) { contact(id: $id) { id } }
      `,
        { id: contacts[0].id },
      )
      expect(res.body.errors).toBeDefined()
      expect(res.body.errors[0].message).toContain('not found')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // TEAM visibility
  // ─────────────────────────────────────────────────────────────────────────
  describe('TEAM visibility', () => {
    it('user with TEAM role sees own + team contacts', async () => {
      const token = signToken(userBId, ['SALES_MANAGER'])
      const res = await graphqlQuery(
        token,
        `
        query { contacts { items { email } } }
      `,
      )
      const emails = res.body.data.contacts.items.map((i: { email: string }) => i.email)
      expect(emails).toContain('contact-a@test.com') // Same team
      expect(emails).toContain('contact-b@test.com') // Own
      expect(emails).not.toContain('contact-c@test.com') // Another user not in team
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // ALL visibility (ADMIN)
  // ─────────────────────────────────────────────────────────────────────────
  describe('ADMIN bypass', () => {
    it('ADMIN user sees all tenant contacts', async () => {
      const token = signToken(userCId, ['ADMIN'])
      const res = await graphqlQuery(
        token,
        `
        query { contacts { items { email } } }
      `,
      )
      const emails = res.body.data.contacts.items.map((i: { email: string }) => i.email)
      expect(emails).toContain('contact-a@test.com')
      expect(emails).toContain('contact-b@test.com')
      expect(emails).toContain('contact-c@test.com')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // VIEW_ALL_DATA bypass
  // ─────────────────────────────────────────────────────────────────────────
  describe('DATA:VIEW_ALL bypass', () => {
    it('user with DATA:VIEW_ALL permission sees all contacts regardless of role', async () => {
      const viewAllPerm = await prisma.permission.findUniqueOrThrow({
        where: { resource_action: { resource: 'DATA', action: 'VIEW_ALL' } },
      })
      await prisma.rolePermission.create({
        data: { roleId: salesRepRoleId, permissionId: viewAllPerm.id },
      })

      const token = signToken(userAId, ['SALES_REP'])
      const res = await graphqlQuery(
        token,
        `
        query { contacts { items { email } } }
      `,
      )
      const emails = res.body.data.contacts.items.map((i: { email: string }) => i.email)
      expect(emails).toContain('contact-a@test.com')
      expect(emails).toContain('contact-b@test.com')
      expect(emails).toContain('contact-c@test.com')

      // Cleanup
      await prisma.rolePermission.deleteMany({
        where: { roleId: salesRepRoleId, permissionId: viewAllPerm.id },
      })
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Cross-tenant isolation
  // ─────────────────────────────────────────────────────────────────────────
  describe('Cross-tenant isolation', () => {
    it('tenant A user cannot see tenant B contacts', async (): Promise<void> => {
      const token = signToken(userCId, ['ADMIN'])
      const res = await graphqlQuery(
        token,
        `
        query { contacts { items { email } } }
      `,
      )
      const emails = res.body.data.contacts.items.map((i: { email: string }) => i.email)
      expect(emails).not.toContain('contact-b2@test.com')
    })
  })
})
