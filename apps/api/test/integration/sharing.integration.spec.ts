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

describe('Sharing Rules (integration)', () => {
  let prisma: PrismaClient
  let container: StartedPostgreSqlContainer
  let app: INestApplication
  let jwtService: JwtService

  let tenantAId: string
  let tenantBId: string
  let ownerId: string
  let granteeUserId: string
  let teamMemberId: string
  let adminId: string
  let teamId: string
  let contactId: string

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

    // Seed CONTACT:UPDATE permission (required by shareRecord mutation)
    await prisma.permission.upsert({
      where: { resource_action: { resource: 'CONTACT', action: 'UPDATE' } },
      create: { resource: 'CONTACT', action: 'UPDATE', description: 'Update contacts' },
      update: {},
    })

    // Seed tenants
    const tenantA = await prisma.tenant.create({ data: { name: 'Tenant A Sharing' } })
    tenantAId = tenantA.id
    const tenantB = await prisma.tenant.create({ data: { name: 'Tenant B Sharing' } })
    tenantBId = tenantB.id

    // Create ADMIN role for tenant A
    const adminRole = await prisma.role.create({
      data: {
        tenantId: tenantAId,
        name: 'ADMIN',
        description: 'Admin',
        isSystem: true,
        dataVisibility: 'ALL',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })

    // Create a regular role (SALES_REP) with CONTACT:UPDATE permission
    const salesRepRole = await prisma.role.create({
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

    // Grant CONTACT:UPDATE to SALES_REP role
    const updatePerm = await prisma.permission.findUnique({
      where: { resource_action: { resource: 'CONTACT', action: 'UPDATE' } },
    })
    if (updatePerm) {
      await prisma.rolePermission.create({
        data: { roleId: salesRepRole.id, permissionId: updatePerm.id },
      })
    }
    // Also grant to ADMIN
    if (updatePerm) {
      await prisma.rolePermission.create({
        data: { roleId: adminRole.id, permissionId: updatePerm.id },
      })
    }

    // Create team
    const team = await prisma.team.create({
      data: { tenantId: tenantAId, name: 'Sharing Team', createdBy: 'test', updatedBy: 'test' },
    })
    teamId = team.id

    // Create users
    const owner = await prisma.user.create({
      data: {
        tenantId: tenantAId,
        email: 'owner@test.com',
        firstName: 'Record',
        lastName: 'Owner',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    ownerId = owner.id

    const grantee = await prisma.user.create({
      data: {
        tenantId: tenantAId,
        email: 'grantee@test.com',
        firstName: 'Shared',
        lastName: 'User',
        teamId: teamId,
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    granteeUserId = grantee.id

    const teamMember = await prisma.user.create({
      data: {
        tenantId: tenantAId,
        email: 'teammate@test.com',
        firstName: 'Team',
        lastName: 'Member',
        teamId: teamId,
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    teamMemberId = teamMember.id

    const admin = await prisma.user.create({
      data: {
        tenantId: tenantAId,
        email: 'admin-sharing@test.com',
        firstName: 'Super',
        lastName: 'Admin',
        teamId: teamId,
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    adminId = admin.id

    // User in tenant B for cross-tenant isolation test
    await prisma.user.create({
      data: {
        tenantId: tenantBId,
        email: 'other-tenant@test.com',
        firstName: 'Other',
        lastName: 'Tenant',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })

    // Assign roles
    await prisma.userRole.create({
      data: { userId: ownerId, roleId: salesRepRole.id, assignedBy: 'test' },
    })
    await prisma.userRole.create({
      data: { userId: granteeUserId, roleId: salesRepRole.id, assignedBy: 'test' },
    })
    await prisma.userRole.create({
      data: { userId: teamMemberId, roleId: salesRepRole.id, assignedBy: 'test' },
    })
    await prisma.userRole.create({
      data: { userId: adminId, roleId: adminRole.id, assignedBy: 'test' },
    })
  }, 120_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    await app?.close()
    await container?.stop()
  })

  afterEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "SharingRule", "Note", "Contact" RESTART IDENTITY CASCADE',
    )
  })

  function signToken(userId: string, roles: string[], tenantId = tenantAId): string {
    return jwtService.sign({
      sub: userId,
      userId,
      tenantId,
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

  async function seedContact(): Promise<string> {
    const contact = await prisma.contact.create({
      data: {
        tenantId: tenantAId,
        email: 'shareable@test.com',
        firstName: 'Shareable',
        lastName: 'Contact',
        ownerId,
        createdBy: ownerId,
        updatedBy: ownerId,
      },
    })
    contactId = contact.id
    return contact.id
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Share a record with another user
  // ─────────────────────────────────────────────────────────────────────────
  describe('shareRecord', () => {
    it('owner can share a contact with another user (READ access)', async () => {
      await seedContact()
      const token = signToken(ownerId, ['SALES_REP'])

      const res = await graphqlQuery(
        token,
        `
        mutation ShareRecord($resourceType: String!, $resourceId: ID!, $sharedWithUserId: ID, $accessLevel: String!) {
          shareRecord(resourceType: $resourceType, resourceId: $resourceId, sharedWithUserId: $sharedWithUserId, accessLevel: $accessLevel) {
            id
            resourceType
            resourceId
            sharedWithUserId
            accessLevel
            sharedBy
          }
        }`,
        {
          resourceType: 'CONTACT',
          resourceId: contactId,
          sharedWithUserId: granteeUserId,
          accessLevel: 'READ',
        },
      )

      expect(res.body.errors).toBeUndefined()
      expect(res.body.data.shareRecord.resourceType).toBe('CONTACT')
      expect(res.body.data.shareRecord.resourceId).toBe(contactId)
      expect(res.body.data.shareRecord.sharedWithUserId).toBe(granteeUserId)
      expect(res.body.data.shareRecord.accessLevel).toBe('READ')
      expect(res.body.data.shareRecord.sharedBy).toBe(ownerId)
    })

    it('non-owner cannot share a contact', async () => {
      await seedContact()
      const token = signToken(granteeUserId, ['SALES_REP'])

      const res = await graphqlQuery(
        token,
        `
        mutation ShareRecord($resourceType: String!, $resourceId: ID!, $sharedWithUserId: ID, $accessLevel: String!) {
          shareRecord(resourceType: $resourceType, resourceId: $resourceId, sharedWithUserId: $sharedWithUserId, accessLevel: $accessLevel) {
            id
          }
        }`,
        {
          resourceType: 'CONTACT',
          resourceId: contactId,
          sharedWithUserId: granteeUserId,
          accessLevel: 'READ',
        },
      )

      expect(res.body.errors).toBeDefined()
      expect(res.body.errors[0].message).toMatch(/owner|cannot share/i)
    })

    it('ADMIN can share any contact', async () => {
      await seedContact()
      const token = signToken(adminId, ['ADMIN'])

      const res = await graphqlQuery(
        token,
        `
        mutation ShareRecord($resourceType: String!, $resourceId: ID!, $sharedWithUserId: ID, $accessLevel: String!) {
          shareRecord(resourceType: $resourceType, resourceId: $resourceId, sharedWithUserId: $sharedWithUserId, accessLevel: $accessLevel) {
            id
            sharedBy
          }
        }`,
        {
          resourceType: 'CONTACT',
          resourceId: contactId,
          sharedWithUserId: granteeUserId,
          accessLevel: 'READ',
        },
      )

      expect(res.body.errors).toBeUndefined()
      expect(res.body.data.shareRecord.sharedBy).toBe(adminId)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Shared record accessible to grantee
  // ─────────────────────────────────────────────────────────────────────────
  describe('Shared record access (OR logic)', () => {
    it('grantee can see the shared contact in contacts list', async () => {
      await seedContact()
      // Owner shares with grantee
      const token = signToken(ownerId, ['SALES_REP'])
      await graphqlQuery(
        token,
        `mutation { shareRecord(resourceType: "CONTACT", resourceId: "${contactId}", sharedWithUserId: "${granteeUserId}", accessLevel: "READ") { id } }`,
      )

      // Grantee queries contacts
      const granteeToken = signToken(granteeUserId, ['SALES_REP'])
      const res = await graphqlQuery(granteeToken, `query { contacts { items { id email } } }`)

      expect(res.body.errors).toBeUndefined()
      const emails = res.body.data.contacts.items.map((i: { email: string }) => i.email)
      expect(emails).toContain('shareable@test.com')
    })

    it('grantee can view the shared contact detail', async () => {
      await seedContact()
      // Owner shares with grantee
      const token = signToken(ownerId, ['SALES_REP'])
      await graphqlQuery(
        token,
        `mutation { shareRecord(resourceType: "CONTACT", resourceId: "${contactId}", sharedWithUserId: "${granteeUserId}", accessLevel: "READ") { id } }`,
      )

      // Grantee views contact
      const granteeToken = signToken(granteeUserId, ['SALES_REP'])
      const res = await graphqlQuery(
        granteeToken,
        `query Contact($id: ID!) { contact(id: $id) { id email ownerId sharedWithMe } }`,
        { id: contactId },
      )

      expect(res.body.errors).toBeUndefined()
      expect(res.body.data.contact.sharedWithMe).toBe(true)
    })

    it('owner can revoke sharing and grantee loses access', async () => {
      await seedContact()
      // Owner shares
      const ownerToken = signToken(ownerId, ['SALES_REP'])
      const shareRes = await graphqlQuery(
        ownerToken,
        `mutation { shareRecord(resourceType: "CONTACT", resourceId: "${contactId}", sharedWithUserId: "${granteeUserId}", accessLevel: "READ") { id } }`,
      )
      const ruleId = shareRes.body.data.shareRecord.id

      // Owner revokes
      await graphqlQuery(ownerToken, `mutation Unshare($id: ID!) { unshareRecord(id: $id) }`, {
        id: ruleId,
      })

      // Grantee can no longer see it
      const granteeToken = signToken(granteeUserId, ['SALES_REP'])
      const res = await graphqlQuery(
        granteeToken,
        `query Contact($id: ID!) { contact(id: $id) { id } }`,
        { id: contactId },
      )

      expect(res.body.errors).toBeDefined()
      expect(res.body.errors[0].message).toContain('not found')
    })

    it('non-shared contact returns 404 for non-owner with OWN visibility', async () => {
      await seedContact()
      const token = signToken(granteeUserId, ['SALES_REP'])
      const res = await graphqlQuery(token, `query Contact($id: ID!) { contact(id: $id) { id } }`, {
        id: contactId,
      })

      expect(res.body.errors).toBeDefined()
      expect(res.body.errors[0].message).toContain('not found')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Team sharing
  // ─────────────────────────────────────────────────────────────────────────
  describe('Team sharing', () => {
    it('sharing with a team grants access to all team members', async () => {
      await seedContact()
      const ownerToken = signToken(ownerId, ['SALES_REP'])
      await graphqlQuery(
        ownerToken,
        `mutation { shareRecord(resourceType: "CONTACT", resourceId: "${contactId}", sharedWithTeamId: "${teamId}", accessLevel: "READ") { id } }`,
      )

      // Team member can see the contact
      const memberToken = signToken(teamMemberId, ['SALES_REP'])
      const res = await graphqlQuery(
        memberToken,
        `query Contact($id: ID!) { contact(id: $id) { id } }`,
        { id: contactId },
      )

      expect(res.body.errors).toBeUndefined()
      expect(res.body.data.contact.id).toBe(contactId)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Cross-tenant isolation
  // ─────────────────────────────────────────────────────────────────────────
  describe('Cross-tenant isolation', () => {
    it('user from another tenant cannot access shared contact', async () => {
      await seedContact()
      const ownerToken = signToken(ownerId, ['SALES_REP'])
      await graphqlQuery(
        ownerToken,
        `mutation { shareRecord(resourceType: "CONTACT", resourceId: "${contactId}", sharedWithUserId: "${granteeUserId}", accessLevel: "READ") { id } }`,
      )

      // User from tenant B (no auth) — we can't easily create a tenant B user with a valid token
      // Instead, verify that a contact from tenant A is not accessible with tenant B's ID
      const otherToken = signToken(granteeUserId, ['SALES_REP'], tenantBId)
      const res = await graphqlQuery(
        otherToken,
        `query Contact($id: ID!) { contact(id: $id) { id } }`,
        { id: contactId },
      )

      expect(res.body.errors).toBeDefined()
      expect(res.body.errors[0].message).toContain('not found')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // sharedWithMe query
  // ─────────────────────────────────────────────────────────────────────────
  describe('sharedWithMe', () => {
    it('returns records shared with the current user', async () => {
      await seedContact()
      const ownerToken = signToken(ownerId, ['SALES_REP'])
      await graphqlQuery(
        ownerToken,
        `mutation { shareRecord(resourceType: "CONTACT", resourceId: "${contactId}", sharedWithUserId: "${granteeUserId}", accessLevel: "EDIT") { id } }`,
      )

      const granteeToken = signToken(granteeUserId, ['SALES_REP'])
      const res = await graphqlQuery(
        granteeToken,
        `query { sharedWithMe { resourceId accessLevel } }`,
      )

      expect(res.body.errors).toBeUndefined()
      expect(res.body.data.sharedWithMe.length).toBeGreaterThanOrEqual(1)
      expect(res.body.data.sharedWithMe.map((r: { resourceId: string }) => r.resourceId)).toContain(
        contactId,
      )
    })

    it('returns records shared with user via team membership', async () => {
      await seedContact()
      const ownerToken = signToken(ownerId, ['SALES_REP'])
      await graphqlQuery(
        ownerToken,
        `mutation { shareRecord(resourceType: "CONTACT", resourceId: "${contactId}", sharedWithTeamId: "${teamId}", accessLevel: "FULL") { id } }`,
      )

      const memberToken = signToken(teamMemberId, ['SALES_REP'])
      const res = await graphqlQuery(memberToken, `query { sharedWithMe { resourceId } }`)

      expect(res.body.errors).toBeUndefined()
      expect(res.body.data.sharedWithMe.length).toBeGreaterThanOrEqual(1)
    })
  })
})
