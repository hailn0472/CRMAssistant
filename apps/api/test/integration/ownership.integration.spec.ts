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

describe('Ownership rules (integration)', () => {
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
      'TRUNCATE TABLE "Activity", "ContactTag", "Tag", "Contact", "User", "UserRole", "Role", "Team", "Tenant" RESTART IDENTITY CASCADE',
    )
  })

  // ─── Helpers ─────────────────────────────────────────

  async function createTenant(name: string): Promise<Tenant> {
    return prisma.tenant.create({ data: { name } })
  }

  async function createUser(
    tenantId: string,
    userId: string,
    overrides: Partial<{ email: string; teamId: string }> = {},
  ): Promise<void> {
    await prisma.user.create({
      data: {
        id: userId,
        tenantId,
        email: overrides.email ?? `${userId}@example.com`,
        firstName: 'Test',
        lastName: 'User',
        teamId: overrides.teamId ?? null,
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
  }

  function signToken(userId: string, tenantId: string, roles: string[] = ['ADMIN']): string {
    return jwtService.sign({
      sub: userId,
      userId,
      tenantId,
      roles,
      email: `${userId}@example.com`,
    })
  }

  async function setupTenant(
    name: string,
    userId: string,
    roleName = 'ADMIN',
    dataVisibility: 'ALL' | 'TEAM' | 'OWN' = 'ALL',
  ): Promise<{ tenant: Tenant; userId: string; token: string }> {
    const tenant = await createTenant(name)
    await createUser(tenant.id, userId)

    // Seed CONTACT:UPDATE permission if not exists
    await prisma.permission.upsert({
      where: { resource_action: { resource: 'CONTACT', action: 'UPDATE' } },
      create: { resource: 'CONTACT', action: 'UPDATE', description: 'Update contacts' },
      update: {},
    })

    const role = await prisma.role.create({
      data: {
        tenantId: tenant.id,
        name: roleName,
        isSystem: true,
        dataVisibility,
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    await prisma.userRole.create({
      data: { userId, roleId: role.id, assignedBy: 'test' },
    })

    // Grant CONTACT:UPDATE permission to role
    const updatePerm = await prisma.permission.findUnique({
      where: { resource_action: { resource: 'CONTACT', action: 'UPDATE' } },
    })
    if (updatePerm) {
      await prisma.rolePermission.create({
        data: { roleId: role.id, permissionId: updatePerm.id },
      })
    }

    return { tenant, userId, token: signToken(userId, tenant.id) }
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

  /** Creates a contact via GraphQL mutation and returns its id. */
  async function createContactViaGraphql(
    token: string,
    email: string,
    firstName = 'Ada',
    lastName = 'Lovelace',
  ): Promise<string> {
    const response = await graphqlRequest(
      token,
      `mutation CreateContact($input: CreateContactInput!) {
        createContact(input: $input) { id email firstName lastName ownerId }
      }`,
      { input: { email, firstName, lastName } },
    )
    expect(response.status).toBe(200)
    expect(response.body.errors).toBeUndefined()
    return response.body.data.createContact.id
  }

  // =========================================================================
  //  SCENARIO 1: assignContactOwner — Sales Rep assigns owner within team
  // =========================================================================
  it('assigns a new owner to a contact via assignContactOwner (INT-O-01)', async () => {
    const { tenant, token } = await setupTenant('OwnerAssign Co', 'owner-assigner')

    // Create a second user to be the new owner
    const newOwnerId = 'new-owner-user'
    await createUser(tenant.id, newOwnerId)

    const contactId = await createContactViaGraphql(token, 'assign-owner@example.com')

    // Assign new owner
    const response = await graphqlRequest(
      token,
      `mutation AssignOwner($contactId: ID!, $userId: ID!) {
        assignContactOwner(contactId: $contactId, userId: $userId) {
          id ownerId
        }
      }`,
      { contactId, userId: newOwnerId },
    )

    expect(response.status).toBe(200)
    expect(response.body.errors).toBeUndefined()
    expect(response.body.data.assignContactOwner.ownerId).toBe(newOwnerId)
  })

  // =========================================================================
  //  SCENARIO 2: assignContactOwnerBulk — bulk assignment with partial success
  // =========================================================================
  it('performs bulk owner assignment with partial success (INT-O-02)', async () => {
    const { token, tenant } = await setupTenant('BulkAssign Co', 'bulk-assigner')
    const tenantAId = tenant.id

    // Create target owner user
    const targetOwnerId = 'target-owner-user'
    await createUser(tenantAId, targetOwnerId)

    // Create two contacts
    const contact1Id = await createContactViaGraphql(token, 'bulk1@example.com')
    const contact2Id = await createContactViaGraphql(token, 'bulk2@example.com')

    // Bulk assign — both should succeed
    const response = await graphqlRequest(
      token,
      `mutation AssignBulk($contactIds: [ID!]!, $userId: ID!) {
        assignContactOwnerBulk(contactIds: $contactIds, userId: $userId) {
          successCount
          failedCount
          errors { contactId error }
        }
      }`,
      { contactIds: [contact1Id, contact2Id], userId: targetOwnerId },
    )

    expect(response.status).toBe(200)
    expect(response.body.errors).toBeUndefined()
    expect(response.body.data.assignContactOwnerBulk.successCount).toBe(2)
    expect(response.body.data.assignContactOwnerBulk.failedCount).toBe(0)
    expect(response.body.data.assignContactOwnerBulk.errors).toHaveLength(0)
  })

  it('reports partial success when some contacts fail in bulk (INT-O-03)', async () => {
    const { token, tenant } = await setupTenant('PartialBulk Co', 'partial-bulk')
    const tenantAId = tenant.id

    // Create target owner
    const targetOwnerId = 'partial-target-owner'
    await createUser(tenantAId, targetOwnerId)

    // Create one real contact and use one fake ID
    const realContactId = await createContactViaGraphql(token, 'partial@example.com')
    const fakeContactId = 'non-existent-contact-id'

    const response = await graphqlRequest(
      token,
      `mutation AssignBulk($contactIds: [ID!]!, $userId: ID!) {
        assignContactOwnerBulk(contactIds: $contactIds, userId: $userId) {
          successCount
          failedCount
          errors { contactId error }
        }
      }`,
      { contactIds: [realContactId, fakeContactId], userId: targetOwnerId },
    )

    expect(response.status).toBe(200)
    expect(response.body.errors).toBeUndefined()
    expect(response.body.data.assignContactOwnerBulk.successCount).toBe(1)
    expect(response.body.data.assignContactOwnerBulk.failedCount).toBe(1)
    expect(response.body.data.assignContactOwnerBulk.errors).toHaveLength(1)
    expect(response.body.data.assignContactOwnerBulk.errors[0].contactId).toBe(fakeContactId)
  })

  // =========================================================================
  //  SCENARIO 3: Permission enforcement — non-admin cannot assign outside scope
  // =========================================================================
  it('rejects owner assignment when user lacks CONTACT:UPDATE permission (INT-O-04)', async () => {
    const { tenant, token: adminToken } = await setupTenant('NoPerm Co', 'no-perm-admin')
    const tenantAId = tenant.id

    // A DISTINCT user holding only a role WITHOUT CONTACT:UPDATE.
    // requirePermission() resolves permissions from every role the user holds
    // in the DB (the JWT `roles` claim only drives the ADMIN bypass), so the
    // viewer must not share a user record with the admin that seeded the data.
    const viewerUserId = 'no-perm-viewer'
    await createUser(tenantAId, viewerUserId)

    const role = await prisma.role.create({
      data: {
        tenantId: tenantAId,
        name: 'VIEWER',
        isSystem: true,
        dataVisibility: 'ALL',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    await prisma.userRole.create({
      data: { userId: viewerUserId, roleId: role.id, assignedBy: 'test' },
    })
    // Do NOT grant CONTACT:UPDATE to this role

    const contactId = await createContactViaGraphql(adminToken, 'noperm@example.com')

    // Now try assigning with the viewer token
    const viewerToken = signToken(viewerUserId, tenantAId, ['VIEWER'])

    const newOwnerId = 'another-user'
    await createUser(tenantAId, newOwnerId)

    const response = await graphqlRequest(
      viewerToken,
      `mutation AssignOwner($contactId: ID!, $userId: ID!) {
        assignContactOwner(contactId: $contactId, userId: $userId) {
          id ownerId
        }
      }`,
      { contactId, userId: newOwnerId },
    )

    // Should fail with 403 Forbidden or similar
    expect(response.status).toBe(200) // GraphQL always returns 200
    expect(response.body.errors).toBeDefined()
    expect(response.body.errors[0].message).toContain('Missing required permission')
  })

  // =========================================================================
  //  SCENARIO 4: Activity timeline verification — CONTACT_OWNER_CHANGED logged
  // =========================================================================
  it('logs CONTACT_OWNER_CHANGED activity when owner is reassigned (INT-O-05)', async () => {
    const { tenant, token, userId } = await setupTenant('ActivityLog Co', 'activity-user')
    const tenantAId = tenant.id

    // Create original owner
    const originalOwnerId = 'original-owner'
    await createUser(tenantAId, originalOwnerId)

    // Create new owner
    const newOwnerId = 'new-owner'
    await createUser(tenantAId, newOwnerId)

    // Create contact
    const contactId = await createContactViaGraphql(token, 'activity@example.com')

    // Assign original owner
    await graphqlRequest(
      token,
      `mutation AssignOwner($contactId: ID!, $userId: ID!) {
        assignContactOwner(contactId: $contactId, userId: $userId) { id ownerId }
      }`,
      { contactId, userId: originalOwnerId },
    )

    // Reassign to new owner — this should log CONTACT_OWNER_CHANGED
    await graphqlRequest(
      token,
      `mutation AssignOwner($contactId: ID!, $userId: ID!) {
        assignContactOwner(contactId: $contactId, userId: $userId) { id ownerId }
      }`,
      { contactId, userId: newOwnerId },
    )

    // Query timeline — should have CONTACT_OWNER_CHANGED activity
    const timelineResponse = await graphqlRequest(
      token,
      `query ContactTimeline($contactId: ID!, $first: Int) {
        contactTimeline(contactId: $contactId, first: $first) {
          edges { node { type title description createdBy } }
          totalCount
        }
      }`,
      { contactId, first: 10 },
    )

    expect(timelineResponse.status).toBe(200)
    expect(timelineResponse.body.errors).toBeUndefined()

    const edges = timelineResponse.body.data.contactTimeline.edges
    const ownerChangedActivity = edges.find(
      (e: { node: { type: string } }) => e.node.type === 'CONTACT_OWNER_CHANGED',
    )
    expect(ownerChangedActivity).toBeDefined()
    expect(ownerChangedActivity.node.title).toBe('Contact owner changed')
    expect(ownerChangedActivity.node.createdBy).toBe(userId)
  })

  // =========================================================================
  //  SCENARIO 5: Cross-tenant isolation — cannot assign to user from another tenant
  // =========================================================================
  it('prevents assigning a user from another tenant as owner (INT-O-06)', async () => {
    const { tenant: tenantA } = await setupTenant('IsolationA Co', 'isolation-user-a')
    const tenantB = await createTenant('IsolationB Co')
    const tenantBUser = 'tenant-b-user'
    await createUser(tenantB.id, tenantBUser)

    const token = signToken('isolation-user-a', tenantA.id)

    const contactId = await createContactViaGraphql(token, 'isolation@example.com')

    // Try assigning tenant B user as owner of tenant A's contact
    const response = await graphqlRequest(
      token,
      `mutation AssignOwner($contactId: ID!, $userId: ID!) {
        assignContactOwner(contactId: $contactId, userId: $userId) {
          id ownerId
        }
      }`,
      { contactId, userId: tenantBUser },
    )

    expect(response.status).toBe(200) // GraphQL always returns 200
    expect(response.body.errors).toBeDefined()
    expect(response.body.errors[0].message).toMatch(/not found|forbidden|access/i)

    // And the contact must still be owned by the tenant A user
    const contact = await prisma.contact.findUniqueOrThrow({ where: { id: contactId } })
    expect(contact.ownerId).not.toBe(tenantBUser)
  })
})
