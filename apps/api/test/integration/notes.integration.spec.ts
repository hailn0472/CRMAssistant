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

// Story 4.7 integration (AC 72). Own TRUNCATE list with "Note" FIRST —
// children before parents. Seeding order is load-bearing: Tenant → Role →
// Permission → User → UserRole → Team → Contact → DealStage → Note.
// createUser() accepts caller-supplied roles: string[] (fix from b3fcdfa).

const CRUD = ['CREATE', 'READ', 'UPDATE', 'DELETE']

const ROLE_PERMISSIONS: Record<string, { resource: string; action: string }[]> = {
  ADMIN: [],
  SALES_REP: [
    ...CRUD.map((action) => ({ resource: 'CONTACT', action })),
    ...CRUD.map((action) => ({ resource: 'DEAL', action })),
  ],
  // Same permissions as SALES_REP, but the authorship tests pair it with
  // dataVisibility 'ALL' so the holder clears the parent gate and the note's
  // author check is the thing under test. Deliberately not named ADMIN — the
  // delete carve-out keys off the ADMIN role name in the JWT.
  SALES_MANAGER: [
    ...CRUD.map((action) => ({ resource: 'CONTACT', action })),
    ...CRUD.map((action) => ({ resource: 'DEAL', action })),
  ],
}

const NOTE_FIELDS = `
  id contactId dealId userId body createdAt updatedAt
  author { id firstName lastName }
`

describe('Notes on Contact & Deal (integration)', () => {
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

  // "Note" MUST be first in the spec's own TRUNCATE list — children before parents.
  afterEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Notification", "Note", "Deal", "DealStage", "Contact", "User", "UserRole", "Role", "Permission", "RolePermission", "Team", "Tenant", "AuditLog" RESTART IDENTITY CASCADE',
    )
  })

  // ─── Seeding helpers ─────────────────────────────────────────────────

  async function createTenant(name: string): Promise<Tenant> {
    return prisma.tenant.create({ data: { name } })
  }

  /**
   * Idempotent per (tenantId, name) — Role carries @@unique([tenantId, name]) and
   * several tests seed two users holding the same role name in one tenant. Reuses
   * the existing row instead of colliding; dataVisibility comes from the first
   * create, since two rows with the same name in a tenant cannot differ anyway.
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
      // Idempotent too — a reused role must not re-grant a permission it already
      // holds (RolePermission is keyed @@id([roleId, permissionId])).
      // eslint-disable-next-line no-await-in-loop
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId: permission.id } },
        update: {},
        create: { roleId, permissionId: permission.id },
      })
    }
  }

  /**
   * createUser with caller-supplied roles: string[] — the fix from b3fcdfa.
   * Creates the User row, the Role row (if not already present via createRole),
   * the UserRole row, and assigns permissions for the role.
   */
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

  /**
   * Also provide a convenience wrapper for creating a user with a single role
   * and explicit role setup, used when we need separate roleVisibility.
   */
  async function createUserWithRole(
    tenantId: string,
    userId: string,
    roleName: string,
    dataVisibility: 'OWN' | 'TEAM' | 'ALL' = 'OWN',
  ): Promise<string> {
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
    const roleId = await createRole(tenantId, roleName, dataVisibility)
    const perms = ROLE_PERMISSIONS[roleName]
    if (perms && perms.length > 0) {
      await grantPermissions(roleId, perms)
    }
    await prisma.userRole.create({ data: { userId, roleId, assignedBy: 'test' } })
    return roleId
  }

  async function createContact(
    tenantId: string,
    ownerId: string,
    email?: string,
  ): Promise<{ id: string }> {
    return prisma.contact.create({
      data: {
        tenantId,
        email: email ?? uniqueEmail('contact'),
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
        probability: 10,
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
  ): Promise<{ id: string }> {
    return prisma.deal.create({
      data: {
        tenantId,
        title: 'Enterprise Deal',
        value: 50000,
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

  // ─── Create note on contact ────────────────────────────────────────────

  it('creates a note on a contact and returns the note with author', async () => {
    const tenant = await createTenant('Acme')
    await createUser(tenant.id, 'rep-1', ['SALES_REP'])
    const contact = await createContact(tenant.id, 'rep-1')
    const token = tokenFor(tenant.id, 'rep-1', ['SALES_REP'])

    const res = await graphqlRequest(
      token,
      `mutation ($input: CreateNoteInput!) {
        createNote(input: $input) { ${NOTE_FIELDS} }
      }`,
      { input: { contactId: contact.id, body: 'Called customer about upgrade' } },
    )

    expect(res.body.errors).toBeUndefined()
    const note = res.body.data.createNote as Record<string, unknown>
    expect(note['body']).toBe('Called customer about upgrade')
    expect(note['contactId']).toBe(contact.id)
    expect(note['dealId']).toBeNull()
    expect(note['userId']).toBe('rep-1')
    expect((note['author'] as Record<string, unknown>)['id']).toBe('rep-1')

    // Row exists in DB
    const row = await prisma.note.findFirst({ where: { id: note['id'] as string } })
    expect(row).not.toBeNull()
    expect(row!.contactId).toBe(contact.id)
    expect(row!.dealId).toBeNull()
    expect(row!.deletedAt).toBeNull()
  })

  it('creates a note on a deal and returns the note with author', async () => {
    const tenant = await createTenant('Acme')
    await createUser(tenant.id, 'rep-1', ['SALES_REP'])
    const contact = await createContact(tenant.id, 'rep-1')
    const stage = await createDealStage(tenant.id, 'Lead', 0)
    const deal = await createDeal(tenant.id, stage.id, contact.id, 'rep-1')
    const token = tokenFor(tenant.id, 'rep-1', ['SALES_REP'])

    const res = await graphqlRequest(
      token,
      `mutation ($input: CreateNoteInput!) {
        createNote(input: $input) { ${NOTE_FIELDS} }
      }`,
      { input: { dealId: deal.id, body: 'Negotiation started with procurement' } },
    )

    expect(res.body.errors).toBeUndefined()
    const note = res.body.data.createNote as Record<string, unknown>
    expect(note['body']).toBe('Negotiation started with procurement')
    expect(note['dealId']).toBe(deal.id)
    expect(note['contactId']).toBeNull()
    expect(note['userId']).toBe('rep-1')
  })

  // ─── Edit note (author-only) ───────────────────────────────────────────

  it('allows the author to edit their own note', async () => {
    const tenant = await createTenant('Acme')
    await createUser(tenant.id, 'rep-1', ['SALES_REP'])
    const contact = await createContact(tenant.id, 'rep-1')
    const token = tokenFor(tenant.id, 'rep-1', ['SALES_REP'])

    const created = await graphqlRequest(
      token,
      `mutation ($input: CreateNoteInput!) {
        createNote(input: $input) { id body }
      }`,
      { input: { contactId: contact.id, body: 'Original note' } },
    )
    expect(created.body.errors).toBeUndefined()
    const noteId = (created.body.data.createNote as { id: string }).id

    const res = await graphqlRequest(
      token,
      `mutation ($id: String!, $input: UpdateNoteInput!) {
        updateNote(id: $id, input: $input) { ${NOTE_FIELDS} }
      }`,
      { id: noteId, input: { body: 'Edited note body' } },
    )

    expect(res.body.errors).toBeUndefined()
    const updated = res.body.data.updateNote as Record<string, unknown>
    expect(updated['body']).toBe('Edited note body')
    expect(updated['updatedAt']).not.toBe(updated['createdAt'])
  })

  it('forbids a non-author from editing a note', async () => {
    const tenant = await createTenant('Acme')
    await createUser(tenant.id, 'rep-1', ['SALES_REP'])
    // rep-2 gets ALL visibility so it clears assertParentAccess on rep-1's
    // contact — otherwise the parent gate rejects first and the authorship
    // rule this test exists to cover is never reached.
    await createUserWithRole(tenant.id, 'rep-2', 'SALES_MANAGER', 'ALL')
    const contact = await createContact(tenant.id, 'rep-1')
    const tokenRep1 = tokenFor(tenant.id, 'rep-1', ['SALES_REP'])
    const tokenRep2 = tokenFor(tenant.id, 'rep-2', ['SALES_MANAGER'])

    // rep-1 creates a note
    const created = await graphqlRequest(
      tokenRep1,
      `mutation ($input: CreateNoteInput!) {
        createNote(input: $input) { id }
      }`,
      { input: { contactId: contact.id, body: 'rep-1 note' } },
    )
    expect(created.body.errors).toBeUndefined()
    const noteId = (created.body.data.createNote as { id: string }).id

    // rep-2 tries to edit — should fail with Forbidden
    const res = await graphqlRequest(
      tokenRep2,
      `mutation ($id: String!, $input: UpdateNoteInput!) {
        updateNote(id: $id, input: $input) { id }
      }`,
      { id: noteId, input: { body: 'Hacked note' } },
    )

    expect(res.body.errors?.[0]?.message).toBe('You can only edit your own notes')
    // Body must remain unchanged
    const row = await prisma.note.findFirst({ where: { id: noteId } })
    expect(row!.body).toBe('rep-1 note')
  })

  // ─── Delete note (author-or-ADMIN) ─────────────────────────────────────

  it('allows the author to delete their own note', async () => {
    const tenant = await createTenant('Acme')
    await createUser(tenant.id, 'rep-1', ['SALES_REP'])
    const contact = await createContact(tenant.id, 'rep-1')
    const token = tokenFor(tenant.id, 'rep-1', ['SALES_REP'])

    const created = await graphqlRequest(
      token,
      `mutation ($input: CreateNoteInput!) {
        createNote(input: $input) { id }
      }`,
      { input: { contactId: contact.id, body: 'To be deleted' } },
    )
    expect(created.body.errors).toBeUndefined()
    const noteId = (created.body.data.createNote as { id: string }).id

    const res = await graphqlRequest(token, `mutation ($id: String!) { deleteNote(id: $id) }`, {
      id: noteId,
    })

    expect(res.body.errors).toBeUndefined()
    expect(res.body.data.deleteNote).toBe(true)

    // Soft-deleted
    const row = await prisma.note.findFirst({ where: { id: noteId } })
    expect(row!.deletedAt).not.toBeNull()
  })

  it('forbids a non-author non-ADMIN from deleting a note', async () => {
    const tenant = await createTenant('Acme')
    await createUser(tenant.id, 'rep-1', ['SALES_REP'])
    // ALL visibility to clear the parent gate, but NOT ADMIN — the delete
    // carve-out is the ADMIN role name in the JWT, and this test asserts the
    // non-ADMIN path is refused.
    await createUserWithRole(tenant.id, 'rep-2', 'SALES_MANAGER', 'ALL')
    const contact = await createContact(tenant.id, 'rep-1')
    const tokenRep1 = tokenFor(tenant.id, 'rep-1', ['SALES_REP'])
    const tokenRep2 = tokenFor(tenant.id, 'rep-2', ['SALES_MANAGER'])

    // rep-1 creates note
    const created = await graphqlRequest(
      tokenRep1,
      `mutation ($input: CreateNoteInput!) {
        createNote(input: $input) { id }
      }`,
      { input: { contactId: contact.id, body: 'rep-1 note' } },
    )
    expect(created.body.errors).toBeUndefined()
    const noteId = (created.body.data.createNote as { id: string }).id

    // rep-2 tries to delete — should fail with Forbidden
    const res = await graphqlRequest(tokenRep2, `mutation ($id: String!) { deleteNote(id: $id) }`, {
      id: noteId,
    })

    expect(res.body.errors?.[0]?.message).toBe('You can only delete your own notes')
    const row = await prisma.note.findFirst({ where: { id: noteId } })
    expect(row!.deletedAt).toBeNull()
  })

  it('allows ADMIN to delete any note', async () => {
    const tenant = await createTenant('Acme')
    await createUser(tenant.id, 'rep-1', ['SALES_REP'])
    await createUser(tenant.id, 'admin-1', ['ADMIN'])
    const contact = await createContact(tenant.id, 'rep-1')
    const tokenRep1 = tokenFor(tenant.id, 'rep-1', ['SALES_REP'])
    const tokenAdmin = tokenFor(tenant.id, 'admin-1', ['ADMIN'])

    // rep-1 creates note
    const created = await graphqlRequest(
      tokenRep1,
      `mutation ($input: CreateNoteInput!) {
        createNote(input: $input) { id }
      }`,
      { input: { contactId: contact.id, body: 'rep-1 note' } },
    )
    expect(created.body.errors).toBeUndefined()
    const noteId = (created.body.data.createNote as { id: string }).id

    // ADMIN deletes rep-1's note
    const res = await graphqlRequest(
      tokenAdmin,
      `mutation ($id: String!) { deleteNote(id: $id) }`,
      { id: noteId },
    )

    expect(res.body.errors).toBeUndefined()
    expect(res.body.data.deleteNote).toBe(true)

    const row = await prisma.note.findFirst({ where: { id: noteId } })
    expect(row!.deletedAt).not.toBeNull()
  })

  // ─── List notes with ordering and pagination ───────────────────────────

  it('lists notes newest-first with pagination', async () => {
    const tenant = await createTenant('Acme')
    await createUser(tenant.id, 'rep-1', ['SALES_REP'])
    const contact = await createContact(tenant.id, 'rep-1')
    const token = tokenFor(tenant.id, 'rep-1', ['SALES_REP'])

    // Create 3 notes
    for (let i = 0; i < 3; i++) {
      await graphqlRequest(
        token,
        `mutation ($input: CreateNoteInput!) {
          createNote(input: $input) { id }
        }`,
        { input: { contactId: contact.id, body: `Note ${i + 1}` } },
      )
    }

    // List all notes
    const res = await graphqlRequest(
      token,
      `query ($filter: NoteFilterInput!) {
        notes(filter: $filter) { total page pageSize items { ${NOTE_FIELDS} } }
      }`,
      { filter: { contactId: contact.id } },
    )

    expect(res.body.errors).toBeUndefined()
    const connection = res.body.data.notes as Record<string, unknown>
    expect(connection['total']).toBe(3)
    expect(connection['page']).toBe(1)
    expect(connection['pageSize']).toBe(20)
    const items = connection['items'] as Array<Record<string, unknown>>
    expect(items).toHaveLength(3)
    // Newest first
    expect(items[0]!['body']).toBe('Note 3')
    expect(items[2]!['body']).toBe('Note 1')
  })

  it('supports pagination with pageSize clamping', async () => {
    const tenant = await createTenant('Acme')
    await createUser(tenant.id, 'rep-1', ['SALES_REP'])
    const contact = await createContact(tenant.id, 'rep-1')
    const token = tokenFor(tenant.id, 'rep-1', ['SALES_REP'])

    // Create 5 notes
    for (let i = 0; i < 5; i++) {
      await graphqlRequest(
        token,
        `mutation ($input: CreateNoteInput!) {
          createNote(input: $input) { id }
        }`,
        { input: { contactId: contact.id, body: `Note ${i + 1}` } },
      )
    }

    // Page 1, size 2
    const res = await graphqlRequest(
      token,
      `query ($filter: NoteFilterInput!, $pagination: NotePaginationInput) {
        notes(filter: $filter, pagination: $pagination) { total page pageSize items { body } }
      }`,
      { filter: { contactId: contact.id }, pagination: { page: 1, pageSize: 2 } },
    )

    expect(res.body.errors).toBeUndefined()
    const connection = res.body.data.notes as Record<string, unknown>
    expect(connection['total']).toBe(5)
    expect(connection['pageSize']).toBe(2)
    const items = connection['items'] as Array<Record<string, unknown>>
    expect(items).toHaveLength(2)
    expect(items[0]!['body']).toBe('Note 5')
    expect(items[1]!['body']).toBe('Note 4')
  })

  // ─── Cross-tenant negative ─────────────────────────────────────────────

  it('prevents cross-tenant access — a note from tenant A is invisible to tenant B', async () => {
    const tenantA = await createTenant('Acme')
    const tenantB = await createTenant('Globex')
    await createUser(tenantA.id, 'rep-a', ['SALES_REP'])
    await createUser(tenantB.id, 'rep-b', ['SALES_REP'])
    const contactA = await createContact(tenantA.id, 'rep-a')
    const tokenA = tokenFor(tenantA.id, 'rep-a', ['SALES_REP'])
    const tokenB = tokenFor(tenantB.id, 'rep-b', ['SALES_REP'])

    // rep-a creates note in tenant A
    const created = await graphqlRequest(
      tokenA,
      `mutation ($input: CreateNoteInput!) {
        createNote(input: $input) { id }
      }`,
      { input: { contactId: contactA.id, body: 'Tenant A note' } },
    )
    expect(created.body.errors).toBeUndefined()
    const noteId = (created.body.data.createNote as { id: string }).id

    // Tenant B tries to read the note via direct ID access
    const res = await graphqlRequest(
      tokenB,
      `mutation ($id: String!, $input: UpdateNoteInput!) {
        updateNote(id: $id, input: $input) { id }
      }`,
      { id: noteId, input: { body: 'Cross-tenant hack' } },
    )

    // Must be NotFound — identical message as any other invisible row
    expect(res.body.errors?.[0]?.message).toBe('Note not found')

    // Also try listing notes from tenant B with a contactId from tenant A
    const listRes = await graphqlRequest(
      tokenB,
      `query ($filter: NoteFilterInput!) {
        notes(filter: $filter) { total }
      }`,
      { filter: { contactId: contactA.id } },
    )
    // Listing is gated on the parent first (findManyForParent → assertParentAccess
    // → checkContactAccess), so a cross-tenant contact fails as 'Contact not found'.
    // Still a 404 with no existence leak — the note itself is never reached.
    expect(listRes.body.errors?.[0]?.message).toBe('Contact not found')
  })

  // ─── Non-ADMIN visibility negative ─────────────────────────────────────

  it("a SALES_REP scoped to OWN cannot read notes on another rep's contact", async () => {
    const tenant = await createTenant('Acme')
    await createUserWithRole(tenant.id, 'rep-1', 'SALES_REP', 'OWN')
    await createUserWithRole(tenant.id, 'rep-2', 'SALES_REP', 'OWN')
    const contact = await createContact(tenant.id, 'rep-1')
    const tokenRep1 = tokenFor(tenant.id, 'rep-1', ['SALES_REP'])
    const tokenRep2 = tokenFor(tenant.id, 'rep-2', ['SALES_REP'])

    // rep-1 creates note on own contact
    await graphqlRequest(
      tokenRep1,
      `mutation ($input: CreateNoteInput!) {
        createNote(input: $input) { id }
      }`,
      { input: { contactId: contact.id, body: 'Private note' } },
    )

    // rep-2 tries to list notes on rep-1's contact
    const res = await graphqlRequest(
      tokenRep2,
      `query ($filter: NoteFilterInput!) {
        notes(filter: $filter) { total items { body } }
      }`,
      { filter: { contactId: contact.id } },
    )

    // Same parent gate: an OWN-scoped rep fails checkContactAccess on the
    // visibility predicate, which reports 'Contact not found' (not 'Note ...').
    expect(res.body.errors?.[0]?.message).toBe('Contact not found')
  })

  // ─── ADMIN bypass case ─────────────────────────────────────────────────

  it('ADMIN reads notes on any contact regardless of ownership', async () => {
    const tenant = await createTenant('Acme')
    await createUserWithRole(tenant.id, 'rep-1', 'SALES_REP', 'OWN')
    await createUser(tenant.id, 'admin-1', ['ADMIN'])
    const contact = await createContact(tenant.id, 'rep-1')
    const tokenRep1 = tokenFor(tenant.id, 'rep-1', ['SALES_REP'])
    const tokenAdmin = tokenFor(tenant.id, 'admin-1', ['ADMIN'])

    // rep-1 creates a note
    await graphqlRequest(
      tokenRep1,
      `mutation ($input: CreateNoteInput!) {
        createNote(input: $input) { id }
      }`,
      { input: { contactId: contact.id, body: 'Rep note' } },
    )

    // ADMIN lists notes
    const res = await graphqlRequest(
      tokenAdmin,
      `query ($filter: NoteFilterInput!) {
        notes(filter: $filter) { total items { body } }
      }`,
      { filter: { contactId: contact.id } },
    )

    expect(res.body.errors).toBeUndefined()
    const connection = res.body.data.notes as Record<string, unknown>
    expect(connection['total']).toBe(1)
  })

  // ─── Body validation at GraphQL layer ──────────────────────────────────

  it('rejects empty note body', async () => {
    const tenant = await createTenant('Acme')
    await createUser(tenant.id, 'rep-1', ['SALES_REP'])
    const contact = await createContact(tenant.id, 'rep-1')
    const token = tokenFor(tenant.id, 'rep-1', ['SALES_REP'])

    // Empty string
    const empty = await graphqlRequest(
      token,
      `mutation ($input: CreateNoteInput!) {
        createNote(input: $input) { id }
      }`,
      { input: { contactId: contact.id, body: '' } },
    )
    expect(empty.body.errors?.[0]?.message).toBe('Note body is required')

    // Whitespace-only
    const whitespace = await graphqlRequest(
      token,
      `mutation ($input: CreateNoteInput!) {
        createNote(input: $input) { id }
      }`,
      { input: { contactId: contact.id, body: '   ' } },
    )
    expect(whitespace.body.errors?.[0]?.message).toBe('Note body is required')

    expect(await prisma.note.count()).toBe(0)
  })

  it('rejects note body over 5000 characters', async () => {
    const tenant = await createTenant('Acme')
    await createUser(tenant.id, 'rep-1', ['SALES_REP'])
    const contact = await createContact(tenant.id, 'rep-1')
    const token = tokenFor(tenant.id, 'rep-1', ['SALES_REP'])

    const tooLong = await graphqlRequest(
      token,
      `mutation ($input: CreateNoteInput!) {
        createNote(input: $input) { id }
      }`,
      { input: { contactId: contact.id, body: 'x'.repeat(5001) } },
    )

    expect(tooLong.body.errors?.[0]?.message).toBe('Note body must not exceed 5000 characters')
    expect(await prisma.note.count()).toBe(0)
  })

  it('accepts note body at exactly 5000 characters', async () => {
    const tenant = await createTenant('Acme')
    await createUser(tenant.id, 'rep-1', ['SALES_REP'])
    const contact = await createContact(tenant.id, 'rep-1')
    const token = tokenFor(tenant.id, 'rep-1', ['SALES_REP'])

    const res = await graphqlRequest(
      token,
      `mutation ($input: CreateNoteInput!) {
        createNote(input: $input) { id body }
      }`,
      { input: { contactId: contact.id, body: 'x'.repeat(5000) } },
    )

    expect(res.body.errors).toBeUndefined()
    const note = res.body.data.createNote as Record<string, unknown>
    expect(note['body']).toHaveLength(5000)
    expect(await prisma.note.count()).toBe(1)
  })

  // ─── XOR validation: exactly one parent ────────────────────────────────

  it('rejects a note with both contactId and dealId set', async () => {
    const tenant = await createTenant('Acme')
    await createUser(tenant.id, 'rep-1', ['SALES_REP'])
    const contact = await createContact(tenant.id, 'rep-1')
    const stage = await createDealStage(tenant.id, 'Lead', 0)
    const deal = await createDeal(tenant.id, stage.id, contact.id, 'rep-1')
    const token = tokenFor(tenant.id, 'rep-1', ['SALES_REP'])

    const res = await graphqlRequest(
      token,
      `mutation ($input: CreateNoteInput!) {
        createNote(input: $input) { id }
      }`,
      { input: { contactId: contact.id, dealId: deal.id, body: 'Bad note' } },
    )

    expect(res.body.errors?.[0]?.message).toBe(
      'A note must be attached to exactly one of contactId or dealId',
    )
    expect(await prisma.note.count()).toBe(0)
  })

  it('rejects a note with neither contactId nor dealId', async () => {
    const tenant = await createTenant('Acme')
    await createUser(tenant.id, 'rep-1', ['SALES_REP'])
    const token = tokenFor(tenant.id, 'rep-1', ['SALES_REP'])

    const res = await graphqlRequest(
      token,
      `mutation ($input: CreateNoteInput!) {
        createNote(input: $input) { id }
      }`,
      { input: { body: 'Orphan note' } },
    )

    expect(res.body.errors?.[0]?.message).toBe(
      'A note must be attached to exactly one of contactId or dealId',
    )
    expect(await prisma.note.count()).toBe(0)
  })
})
