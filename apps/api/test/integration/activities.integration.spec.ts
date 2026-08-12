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

describe('Activity timeline (integration)', () => {
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
      'TRUNCATE TABLE "Notification", "Activity", "ContactTag", "Tag", "Note", "Contact", "User", "UserRole", "Role", "Team", "Tenant" RESTART IDENTITY CASCADE',
    )
  })

  async function createTenant(name: string): Promise<Tenant> {
    return prisma.tenant.create({ data: { name } })
  }

  async function createTestUser(tenantId: string, userId: string): Promise<void> {
    await prisma.user.create({
      data: {
        id: userId,
        tenantId,
        email: `${userId}@example.com`,
        firstName: 'Test',
        lastName: 'User',
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
  ): Promise<{ tenant: Tenant; userId: string; token: string }> {
    const tenant = await createTenant(name)
    await createTestUser(tenant.id, userId)
    // Create system ADMIN role with ALL visibility so createContact/updateContact work
    const role = await prisma.role.create({
      data: {
        tenantId: tenant.id,
        name: 'ADMIN',
        isSystem: true,
        dataVisibility: 'ALL',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    await prisma.userRole.create({
      data: { userId, roleId: role.id, assignedBy: 'test' },
    })
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
        createContact(input: $input) { id email firstName lastName }
      }`,
      { input: { email, firstName, lastName } },
    )
    expect(response.status).toBe(200)
    expect(response.body.errors).toBeUndefined()
    return response.body.data.createContact.id
  }

  /** Adds a note to a contact via GraphQL mutation, returning the activity id. */
  async function addNoteViaGraphql(
    token: string,
    contactId: string,
    title: string,
    description?: string,
  ): Promise<string> {
    const response = await graphqlRequest(
      token,
      `mutation AddContactNote($contactId: ID!, $title: String!, $description: String) {
        addContactNote(contactId: $contactId, title: $title, description: $description) { id type title description createdAt }
      }`,
      { contactId, title, description },
    )
    expect(response.status).toBe(200)
    expect(response.body.errors).toBeUndefined()
    return response.body.data.addContactNote.id
  }

  // =========================================================================
  //  SCENARIO 1: contactTimeline query returns activities sorted DESC
  // =========================================================================
  it('returns activities sorted by createdAt DESC (INT-A-01)', async () => {
    const { token } = await setupTenant('Sort Co', 'sort-user')

    // Create a contact — auto-logs CONTACT_CREATED
    const contactId = await createContactViaGraphql(token, 'sort@example.com')

    // Add two notes with a small delay so createdAt differs
    await addNoteViaGraphql(token, contactId, 'First note')
    await new Promise((r) => setTimeout(r, 10))
    await addNoteViaGraphql(token, contactId, 'Second note')

    // Query timeline
    const response = await graphqlRequest(
      token,
      `query ContactTimeline($contactId: ID!, $first: Int) {
        contactTimeline(contactId: $contactId, first: $first) {
          edges { cursor node { id type title description createdAt } }
          pageInfo { hasNextPage endCursor }
          totalCount
        }
      }`,
      { contactId, first: 20 },
    )

    expect(response.status).toBe(200)
    expect(response.body.errors).toBeUndefined()
    expect(response.body.data.contactTimeline.totalCount).toBeGreaterThanOrEqual(3)

    const edges = response.body.data.contactTimeline.edges
    // Verify DESC order by comparing timestamps
    const timestamps = edges.map((e: { node: { createdAt: string } }) =>
      new Date(e.node.createdAt).getTime(),
    )
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]!).toBeLessThanOrEqual(timestamps[i - 1]!)
    }
  })

  // =========================================================================
  //  SCENARIO 2: Auto-logging CONTACT_CREATED when contact is created
  // =========================================================================
  it('auto-logs CONTACT_CREATED activity when a contact is created (INT-A-02)', async () => {
    const { token, userId } = await setupTenant('AutoLog Co', 'autolog-user')

    const contactId = await createContactViaGraphql(token, 'autolog@example.com')

    // Query timeline — should include CONTACT_CREATED
    const response = await graphqlRequest(
      token,
      `query ContactTimeline($contactId: ID!, $first: Int) {
        contactTimeline(contactId: $contactId, first: $first) {
          edges { node { type title description createdBy } }
          totalCount
        }
      }`,
      { contactId, first: 5 },
    )

    expect(response.status).toBe(200)
    expect(response.body.errors).toBeUndefined()

    const edges = response.body.data.contactTimeline.edges
    const createdActivity = edges.find(
      (e: { node: { type: string } }) => e.node.type === 'CONTACT_CREATED',
    )
    expect(createdActivity).toBeDefined()
    expect(createdActivity.node.title).toBe('Contact created')
    expect(createdActivity.node.description).toContain('Ada Lovelace')
    expect(createdActivity.node.createdBy).toBe(userId)
  })

  // =========================================================================
  //  SCENARIO 3: Auto-logging CONTACT_UPDATED when contact is updated
  // =========================================================================
  it('auto-logs CONTACT_UPDATED activity when a contact is updated (INT-A-03)', async () => {
    const { token, userId } = await setupTenant('UpdateLog Co', 'updatelog-user')

    const contactId = await createContactViaGraphql(token, 'updatelog@example.com', 'Old', 'Name')

    // Update contact
    const updateResponse = await graphqlRequest(
      token,
      `mutation UpdateContact($id: ID!, $input: UpdateContactInput!) {
        updateContact(id: $id, input: $input) { id firstName lastName }
      }`,
      { id: contactId, input: { firstName: 'New', lastName: 'Name' } },
    )
    expect(updateResponse.status).toBe(200)
    expect(updateResponse.body.errors).toBeUndefined()

    // Query timeline — should include CONTACT_UPDATED
    const response = await graphqlRequest(
      token,
      `query ContactTimeline($contactId: ID!, $first: Int) {
        contactTimeline(contactId: $contactId, first: $first) {
          edges { node { type title description createdBy } }
          totalCount
        }
      }`,
      { contactId, first: 10 },
    )

    expect(response.status).toBe(200)
    expect(response.body.errors).toBeUndefined()

    const edges = response.body.data.contactTimeline.edges
    const updatedActivity = edges.find(
      (e: { node: { type: string } }) => e.node.type === 'CONTACT_UPDATED',
    )
    expect(updatedActivity).toBeDefined()
    expect(updatedActivity.node.title).toBe('Contact updated')
    expect(updatedActivity.node.description).toContain('firstName')
    expect(updatedActivity.node.createdBy).toBe(userId)
  })

  // =========================================================================
  //  SCENARIO 4: Manual note creation via addContactNote mutation
  // =========================================================================
  it('creates a NOTE_ADDED activity via addContactNote mutation (INT-A-04)', async () => {
    const { token, userId } = await setupTenant('Note Co', 'note-user')

    const contactId = await createContactViaGraphql(token, 'note@example.com')

    // Add a manual note
    const noteResponse = await graphqlRequest(
      token,
      `mutation AddContactNote($contactId: ID!, $title: String!, $description: String) {
        addContactNote(contactId: $contactId, title: $title, description: $description) {
          id type title description createdBy
        }
      }`,
      {
        contactId,
        title: 'Met with client',
        description: 'Discussed project timeline and budget.',
      },
    )

    expect(noteResponse.status).toBe(200)
    expect(noteResponse.body.errors).toBeUndefined()
    expect(noteResponse.body.data.addContactNote.type).toBe('NOTE_ADDED')
    expect(noteResponse.body.data.addContactNote.title).toBe('Met with client')
    expect(noteResponse.body.data.addContactNote.description).toBe(
      'Discussed project timeline and budget.',
    )
    expect(noteResponse.body.data.addContactNote.createdBy).toBe(userId)

    // Query timeline — should include the note
    const timelineResponse = await graphqlRequest(
      token,
      `query ContactTimeline($contactId: ID!, $first: Int) {
        contactTimeline(contactId: $contactId, first: $first) {
          edges { node { type title description } }
          totalCount
        }
      }`,
      { contactId, first: 10 },
    )

    expect(timelineResponse.status).toBe(200)
    const edges = timelineResponse.body.data.contactTimeline.edges
    const noteActivity = edges.find((e: { node: { type: string } }) => e.node.type === 'NOTE_ADDED')
    expect(noteActivity).toBeDefined()
    expect(noteActivity.node.title).toBe('Met with client')
  })

  // =========================================================================
  //  SCENARIO 5: Timeline pagination (first + after cursor)
  // =========================================================================
  it('supports cursor-based pagination (INT-A-05)', async () => {
    const { token } = await setupTenant('Pagination Co', 'pagination-user')

    const contactId = await createContactViaGraphql(token, 'page@example.com')

    // Add 5 notes so we have enough activities
    for (let i = 0; i < 5; i++) {
      await addNoteViaGraphql(token, contactId, `Note ${i + 1}`)
    }

    // Page 1: first=3
    const page1 = await graphqlRequest(
      token,
      `query ContactTimeline($contactId: ID!, $first: Int) {
        contactTimeline(contactId: $contactId, first: $first) {
          edges { cursor node { id title } }
          pageInfo { hasNextPage endCursor }
          totalCount
        }
      }`,
      { contactId, first: 3 },
    )

    expect(page1.status).toBe(200)
    expect(page1.body.errors).toBeUndefined()
    expect(page1.body.data.contactTimeline.edges).toHaveLength(3)
    expect(page1.body.data.contactTimeline.pageInfo.hasNextPage).toBe(true)
    expect(page1.body.data.contactTimeline.pageInfo.endCursor).not.toBeNull()

    const endCursor = page1.body.data.contactTimeline.pageInfo.endCursor

    // Page 2: first=3, after=endCursor
    const page2 = await graphqlRequest(
      token,
      `query ContactTimeline($contactId: ID!, $first: Int, $after: String) {
        contactTimeline(contactId: $contactId, first: $first, after: $after) {
          edges { cursor node { id title } }
          pageInfo { hasNextPage endCursor }
          totalCount
        }
      }`,
      { contactId, first: 3, after: endCursor },
    )

    expect(page2.status).toBe(200)
    expect(page2.body.errors).toBeUndefined()
    expect(page2.body.data.contactTimeline.edges.length).toBeGreaterThan(0)
    // Total count should include all activities (CONTACT_CREATED + 5 notes)
    expect(page2.body.data.contactTimeline.totalCount).toBeGreaterThanOrEqual(6)
  })

  // =========================================================================
  //  SCENARIO 6: Tenant isolation
  // =========================================================================
  it('returns activities only for the same tenant (INT-A-06)', async () => {
    const tenantA = await setupTenant('Tenant A', 'tenant-a-user')
    const tenantB = await setupTenant('Tenant B', 'tenant-b-user')

    // Create contact in tenant A and add an activity
    const contactAId = await createContactViaGraphql(tenantA.token, 'a@example.com')
    await addNoteViaGraphql(tenantA.token, contactAId, 'Tenant A note')

    // Create contact in tenant B and add an activity
    const contactBId = await createContactViaGraphql(tenantB.token, 'b@example.com')
    await addNoteViaGraphql(tenantB.token, contactBId, 'Tenant B note')

    // Tenant A must NOT see tenant B's activity
    const responseA = await graphqlRequest(
      tenantA.token,
      `query ContactTimeline($contactId: ID!, $first: Int) {
        contactTimeline(contactId: $contactId, first: $first) {
          edges { node { title } }
          totalCount
        }
      }`,
      { contactId: contactAId, first: 10 },
    )

    expect(responseA.status).toBe(200)
    expect(responseA.body.errors).toBeUndefined()
    const titlesA = responseA.body.data.contactTimeline.edges.map(
      (e: { node: { title: string } }) => e.node.title,
    )
    expect(titlesA).not.toContain('Tenant B note')

    // Tenant B must NOT see tenant A's activity
    const responseB = await graphqlRequest(
      tenantB.token,
      `query ContactTimeline($contactId: ID!, $first: Int) {
        contactTimeline(contactId: $contactId, first: $first) {
          edges { node { title } }
          totalCount
        }
      }`,
      { contactId: contactBId, first: 10 },
    )

    expect(responseB.status).toBe(200)
    const titlesB = responseB.body.data.contactTimeline.edges.map(
      (e: { node: { title: string } }) => e.node.title,
    )
    expect(titlesB).not.toContain('Tenant A note')
  })

  // =========================================================================
  //  SCENARIO 7: Empty timeline for contact with no activities
  // =========================================================================
  it('returns empty timeline for contact with no activities (INT-A-07)', async () => {
    const { token } = await setupTenant('Empty Co', 'empty-user')

    const contactId = await createContactViaGraphql(token, 'empty@example.com')

    // Direct DB clean-up: remove the auto-logged CONTACT_CREATED activity
    // so the contact truly has no activities
    await prisma.activity.deleteMany({ where: { contactId } })

    const response = await graphqlRequest(
      token,
      `query ContactTimeline($contactId: ID!, $first: Int) {
        contactTimeline(contactId: $contactId, first: $first) {
          edges { node { id type title } }
          pageInfo { hasNextPage endCursor }
          totalCount
        }
      }`,
      { contactId, first: 20 },
    )

    expect(response.status).toBe(200)
    expect(response.body.errors).toBeUndefined()
    expect(response.body.data.contactTimeline.edges).toHaveLength(0)
    expect(response.body.data.contactTimeline.totalCount).toBe(0)
    expect(response.body.data.contactTimeline.pageInfo.hasNextPage).toBe(false)
    expect(response.body.data.contactTimeline.pageInfo.endCursor).toBeNull()
  })

  // =========================================================================
  //  SCENARIO 8: Non-existent contact returns error
  // =========================================================================
  it('returns error for non-existent contact (INT-A-08)', async () => {
    const { token } = await setupTenant('Missing Co', 'missing-user')

    const nonExistentId = '00000000-0000-0000-0000-000000000000'

    const response = await graphqlRequest(
      token,
      `query ContactTimeline($contactId: ID!, $first: Int) {
        contactTimeline(contactId: $contactId, first: $first) {
          edges { node { id type title } }
          pageInfo { hasNextPage endCursor }
          totalCount
        }
      }`,
      { contactId: nonExistentId, first: 20 },
    )

    expect(response.status).toBe(200)
    // Visibility check throws "Contact not found" for non-existent contacts
    expect(response.body.errors).toBeDefined()
    expect(response.body.errors[0].message).toMatch(/not found/i)
  })
})
