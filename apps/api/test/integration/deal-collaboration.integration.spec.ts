import { execFileSync } from 'child_process'
import * as path from 'path'

import { INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { JwtService } from '@nestjs/jwt'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { PostgreSqlContainer } from '@testcontainers/postgresql'

import { AppModule } from '../../src/app.module'
import { SupabaseStorageService } from '../../src/storage/supabase-storage.service'

import type { Tenant } from '@prisma/client'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'

describe('Deal document & comment collaboration (integration)', () => {
  let prisma: PrismaClient
  let container: StartedPostgreSqlContainer
  let app: INestApplication
  let jwtService: JwtService

  // In-memory Supabase Storage fake — there is no Supabase emulator in the test
  // harness and testcontainers cannot provide one. It records upload/remove
  // calls and returns a stub signed URL so assertions stay concrete.
  const fakeStorage = {
    uploadedObjects: [] as Array<{ objectPath: string; body: Buffer; mimeType: string }>,
    removedObjects: [] as string[],
    upload: jest.fn(async (objectPath: string, body: Buffer, mimeType: string) => {
      fakeStorage.uploadedObjects.push({ objectPath, body, mimeType })
    }),
    createSignedUrl: jest.fn(async (objectPath: string) => `https://signed.example/${objectPath}`),
    remove: jest.fn(async (objectPath: string) => {
      fakeStorage.removedObjects.push(objectPath)
    }),
  }

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
    })
      .overrideProvider(SupabaseStorageService)
      .useValue(fakeStorage as unknown as SupabaseStorageService)
      .compile()

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
      'TRUNCATE TABLE "Deal", "DealStage", "Contact", "User", "UserRole", "Role", "Permission", "RolePermission", "Team", "Tenant", "DealDocument", "DealComment", "DealCommentMention", "AuditLog" RESTART IDENTITY CASCADE',
    )
    fakeStorage.uploadedObjects = []
    fakeStorage.removedObjects = []
    jest.clearAllMocks()
  })

  async function createTenant(name: string): Promise<Tenant> {
    return prisma.tenant.create({ data: { name } })
  }

  async function createUser(tenantId: string, userId: string): Promise<void> {
    // User must exist BEFORE any Contact referencing it (Contact.ownerId FK)
    await prisma.user.create({
      data: {
        id: userId,
        tenantId,
        email: uniqueEmail('user'),
        firstName: 'Test',
        lastName: 'User',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
  }

  async function createRole(
    tenantId: string,
    roleId: string,
    name: string,
    dataVisibility: 'OWN' | 'TEAM' | 'ALL' = 'OWN',
  ): Promise<void> {
    await prisma.role.create({
      data: { id: roleId, tenantId, name, isSystem: true, dataVisibility },
    })
  }

  async function assignRole(userId: string, roleId: string): Promise<void> {
    await prisma.userRole.create({ data: { userId, roleId } })
  }

  async function grantPermission(roleId: string, resource: string, action: string): Promise<void> {
    const permission = await prisma.permission.upsert({
      where: { resource_action: { resource, action } },
      create: { resource, action, description: `${action} ${resource}` },
      update: {},
    })
    await prisma.rolePermission
      .create({ data: { roleId, permissionId: permission.id } })
      .catch(() => {})
  }

  async function createDealStage(
    tenantId: string,
    name: string,
    order: number,
    probability = 10,
  ): Promise<{ id: string }> {
    return prisma.dealStage.create({
      data: {
        tenantId,
        name,
        order,
        probability,
        color: '#3B82F6',
        createdBy: 'system',
        updatedBy: 'system',
      },
      select: { id: true },
    })
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

  async function createDeal(
    tenantId: string,
    stageId: string,
    contactId: string,
    ownerId: string,
    overrides: Record<string, unknown> = {},
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
        ...overrides,
      },
      select: { id: true },
    })
  }

  async function seedDealFixture(tenant: Tenant, ownerId: string): Promise<{ id: string }> {
    const stage = await createDealStage(tenant.id, 'Lead', 0)
    const contact = await createContact(tenant.id, ownerId)
    return createDeal(tenant.id, stage.id, contact.id, ownerId)
  }

  function tokenFor(tenantId: string, userId: string, roles: string[] = ['ADMIN']): string {
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

  // ─── REST upload (AC #14-#16, #36) ────────────────────────────────────────

  it('uploads a PDF via REST: row created, tenant-first storage path, audit entry written', async () => {
    const tenant = await createTenant('Acme')
    await createUser(tenant.id, 'admin-1')
    const deal = await seedDealFixture(tenant, 'admin-1')
    const token = tokenFor(tenant.id, 'admin-1')

    const response = await request(app.getHttpServer())
      .post(`/api/deals/${deal.id}/documents`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('%PDF-1.7\nfake-pdf-content'), 'contract.pdf')

    expect(response.status).toBe(201)
    const body = response.body as Record<string, unknown>
    expect(body['fileName']).toBe('contract.pdf')
    expect(body['mimeType']).toBe('application/pdf')
    expect(body['dealId']).toBe(deal.id)

    const row = await prisma.dealDocument.findFirst({
      where: { id: body['id'] as string },
    })
    expect(row).not.toBeNull()
    expect(row!.storagePath).toMatch(new RegExp(`^deals/${tenant.id}/${deal.id}/`))
    expect(row!.storagePath.endsWith('-contract.pdf')).toBe(true)
    expect(row!.uploadedBy).toBe('admin-1')
    expect(row!.createdBy).toBe('admin-1')

    // Exactly one object hit the fake storage with the same path as the row.
    expect(fakeStorage.uploadedObjects).toHaveLength(1)
    expect(fakeStorage.uploadedObjects[0]!.objectPath).toBe(row!.storagePath)
    expect(fakeStorage.uploadedObjects[0]!.mimeType).toBe('application/pdf')

    // The REST path is the one write in this story that handles user files —
    // it must appear in the audit log (NFR9 / AC 36).
    const audit = await prisma.auditLog.findFirst({
      where: { entityId: deal.id, action: 'CREATE', entity: 'DEAL' },
    })
    expect(audit).not.toBeNull()
    expect((audit!.details as Record<string, unknown>)['fileName']).toBe('contract.pdf')
  })

  it('rejects a renamed .exe with 400 and writes nothing anywhere', async () => {
    const tenant = await createTenant('Acme')
    await createUser(tenant.id, 'admin-1')
    const deal = await seedDealFixture(tenant, 'admin-1')
    const token = tokenFor(tenant.id, 'admin-1')

    const response = await request(app.getHttpServer())
      .post(`/api/deals/${deal.id}/documents`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('MZ\x90\x00this-is-a-portable-executable'), 'contract.pdf')

    expect(response.status).toBe(400)
    expect((response.body as { message?: unknown }).message).toBe(
      'Unsupported file type. Allowed: PDF, DOCX, XLSX, PNG, JPG',
    )
    expect(await prisma.dealDocument.count()).toBe(0)
    expect(fakeStorage.uploadedObjects).toHaveLength(0)
  })

  it('returns Deal not found for a second tenants token — no cross-tenant upload', async () => {
    const tenantA = await createTenant('Acme')
    await createUser(tenantA.id, 'admin-1')
    const deal = await seedDealFixture(tenantA, 'admin-1')

    const tenantB = await createTenant('Globex')
    await createUser(tenantB.id, 'admin-2')
    const foreignToken = tokenFor(tenantB.id, 'admin-2')

    const response = await request(app.getHttpServer())
      .post(`/api/deals/${deal.id}/documents`)
      .set('Authorization', `Bearer ${foreignToken}`)
      .attach('file', Buffer.from('%PDF-1.7\nfake'), 'contract.pdf')

    expect(response.status).toBe(404)
    expect((response.body as { message?: unknown }).message).toBe('Deal not found')
    expect(await prisma.dealDocument.count()).toBe(0)
    expect(fakeStorage.uploadedObjects).toHaveLength(0)
  })

  it('requires DEAL:UPDATE — a SALES_REP without the grant gets 403', async () => {
    const tenant = await createTenant('Acme')
    await createUser(tenant.id, 'rep-1')
    const deal = await seedDealFixture(tenant, 'rep-1')
    await createRole(tenant.id, 'role-noperm', 'NO_DEAL_PERMS', 'OWN')
    await assignRole('rep-1', 'role-noperm')

    const response = await request(app.getHttpServer())
      .post(`/api/deals/${deal.id}/documents`)
      .set('Authorization', `Bearer ${tokenFor(tenant.id, 'rep-1', ['SALES_REP'])}`)
      .attach('file', Buffer.from('%PDF-1.7\nfake'), 'contract.pdf')

    expect(response.status).toBe(403)
    expect(await prisma.dealDocument.count()).toBe(0)
  })

  // ─── GraphQL document queries/mutations (AC #17-#20) ──────────────────────

  it('lists dealDocuments newest-first with the uploader profile', async () => {
    const tenant = await createTenant('Acme')
    await createUser(tenant.id, 'admin-1')
    const deal = await seedDealFixture(tenant, 'admin-1')
    const token = tokenFor(tenant.id, 'admin-1')

    const first = await request(app.getHttpServer())
      .post(`/api/deals/${deal.id}/documents`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('%PDF-1.7\none'), 'first.pdf')
    const second = await request(app.getHttpServer())
      .post(`/api/deals/${deal.id}/documents`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('%PDF-1.7\ntwo'), 'second.pdf')
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)

    const res = await graphqlRequest(
      token,
      `query ($dealId: ID!) {
        dealDocuments(dealId: $dealId) { id fileName mimeType fileSize createdAt uploader { id firstName lastName email } }
      }`,
      { dealId: deal.id },
    )

    expect(res.body.errors).toBeUndefined()
    const docs = res.body.data.dealDocuments as Array<Record<string, unknown>>
    expect(docs).toHaveLength(2)
    // Newest first
    expect(docs[0]!['fileName']).toBe('second.pdf')
    expect(docs[1]!['fileName']).toBe('first.pdf')
    expect((docs[0]!['uploader'] as Record<string, unknown>)['id']).toBe('admin-1')
  })

  it('mints a fresh signed URL per download and denies a colleague with OWN visibility', async () => {
    const tenant = await createTenant('Acme')
    await createUser(tenant.id, 'rep-a')
    await createUser(tenant.id, 'rep-b')
    const deal = await seedDealFixture(tenant, 'rep-a')
    // rep-b has DEAL:READ but OWN visibility — the deal belongs to rep-a.
    await createRole(tenant.id, 'role-rep', 'SALES_REP', 'OWN')
    await grantPermission('role-rep', 'DEAL', 'READ')
    await grantPermission('role-rep', 'DEAL', 'UPDATE')
    await assignRole('rep-a', 'role-rep')
    await assignRole('rep-b', 'role-rep')

    const upload = await request(app.getHttpServer())
      .post(`/api/deals/${deal.id}/documents`)
      .set('Authorization', `Bearer ${tokenFor(tenant.id, 'rep-a', ['SALES_REP'])}`)
      .attach('file', Buffer.from('%PDF-1.7\nsecret'), 'secret.pdf')
    expect(upload.status).toBe(201)
    const documentId = (upload.body as { id: string }).id

    // The owner can mint a URL.
    const ownerRes = await graphqlRequest(
      tokenFor(tenant.id, 'rep-a', ['SALES_REP']),
      `query ($id: ID!) { dealDocumentDownloadUrl(id: $id) }`,
      { id: documentId },
    )
    expect(ownerRes.body.errors).toBeUndefined()
    expect(ownerRes.body.data.dealDocumentDownloadUrl).toBe(
      `https://signed.example/deals/${tenant.id}/${deal.id}/${documentId}-secret.pdf`,
    )

    // The colleague with OWN visibility cannot — the deal check inside the
    // service resolves visibility and must reject.
    const colleagueRes = await graphqlRequest(
      tokenFor(tenant.id, 'rep-b', ['SALES_REP']),
      `query ($id: ID!) { dealDocumentDownloadUrl(id: $id) }`,
      { id: documentId },
    )
    expect(colleagueRes.body.errors?.[0]?.message).toBe('Deal not found')
  })

  it('soft-deletes a document row and hard-removes the storage object', async () => {
    const tenant = await createTenant('Acme')
    await createUser(tenant.id, 'admin-1')
    const deal = await seedDealFixture(tenant, 'admin-1')
    const token = tokenFor(tenant.id, 'admin-1')

    const upload = await request(app.getHttpServer())
      .post(`/api/deals/${deal.id}/documents`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('%PDF-1.7\nbye'), 'bye.pdf')
    const documentId = (upload.body as { id: string }).id
    const storagePath = (upload.body as { storagePath: string }).storagePath

    const res = await graphqlRequest(token, `mutation ($id: ID!) { deleteDealDocument(id: $id) }`, {
      id: documentId,
    })
    expect(res.body.errors).toBeUndefined()
    expect(res.body.data.deleteDealDocument).toBe(true)

    const row = await prisma.dealDocument.findFirst({ where: { id: documentId } })
    expect(row!.deletedAt).not.toBeNull()
    expect(row!.updatedBy).toBe('admin-1')
    // The object is hard-removed — a soft-deleted document is not restorable.
    expect(fakeStorage.removedObjects).toContain(storagePath)
  })

  // ─── Comments and @mentions (AC #21-#25, #31) ─────────────────────────────

  it('adds a comment with a mention: exactly one DealCommentMention row, cross-tenant id dropped', async () => {
    const tenant = await createTenant('Acme')
    await createUser(tenant.id, 'admin-1')
    await createUser(tenant.id, 'user-2')
    const deal = await seedDealFixture(tenant, 'admin-1')

    const tenantB = await createTenant('Globex')
    await createUser(tenantB.id, 'stranger-1')

    const res = await graphqlRequest(
      tokenFor(tenant.id, 'admin-1'),
      `mutation ($input: AddDealCommentInput!) {
        addDealComment(input: $input) { id comment author { id firstName } mentionedUsers { id } }
      }`,
      {
        input: {
          dealId: deal.id,
          comment: 'cc @[Test User](user-2) and @[Stranger](stranger-1)',
        },
      },
    )

    expect(res.body.errors).toBeUndefined()
    const comment = res.body.data.addDealComment as Record<string, unknown>
    expect(comment['comment']).toBe('cc @[Test User](user-2) and @[Stranger](stranger-1)')
    expect((comment['author'] as Record<string, unknown>)['id']).toBe('admin-1')

    // Exactly one mention row — the cross-tenant id was dropped silently.
    const mentions = await prisma.dealCommentMention.findMany({
      where: { commentId: comment['id'] as string },
    })
    expect(mentions).toHaveLength(1)
    expect(mentions[0]!.mentionedUserId).toBe('user-2')
    // The mention is reflected in the GraphQL payload too.
    expect((comment['mentionedUsers'] as Array<Record<string, unknown>>)[0]!['id']).toBe('user-2')
  })

  it('rejects an empty comment and a comment over 5000 characters', async () => {
    const tenant = await createTenant('Acme')
    await createUser(tenant.id, 'admin-1')
    const deal = await seedDealFixture(tenant, 'admin-1')
    const token = tokenFor(tenant.id, 'admin-1')

    const empty = await graphqlRequest(
      token,
      `mutation ($input: AddDealCommentInput!) { addDealComment(input: $input) { id } }`,
      { input: { dealId: deal.id, comment: '   ' } },
    )
    expect(empty.body.errors?.[0]?.message).toBe('comment is required')

    const tooLong = await graphqlRequest(
      token,
      `mutation ($input: AddDealCommentInput!) { addDealComment(input: $input) { id } }`,
      { input: { dealId: deal.id, comment: 'x'.repeat(5001) } },
    )
    expect(tooLong.body.errors?.[0]?.message).toBe('comment must not exceed 5000 characters')
    expect(await prisma.dealComment.count()).toBe(0)
  })

  it('returns the thread oldest-first with author and mentionedUsers', async () => {
    const tenant = await createTenant('Acme')
    await createUser(tenant.id, 'admin-1')
    await createUser(tenant.id, 'user-2')
    const deal = await seedDealFixture(tenant, 'admin-1')
    const token = tokenFor(tenant.id, 'admin-1')

    const first = await graphqlRequest(
      token,
      `mutation ($input: AddDealCommentInput!) { addDealComment(input: $input) { id } }`,
      { input: { dealId: deal.id, comment: 'first comment' } },
    )
    const second = await graphqlRequest(
      token,
      `mutation ($input: AddDealCommentInput!) { addDealComment(input: $input) { id } }`,
      { input: { dealId: deal.id, comment: '@[Test User](user-2) second' } },
    )
    expect(first.body.errors).toBeUndefined()
    expect(second.body.errors).toBeUndefined()

    const res = await graphqlRequest(
      token,
      `query ($dealId: ID!) {
        dealComments(dealId: $dealId) { total page pageSize items { id comment author { id } mentionedUsers { id } } }
      }`,
      { dealId: deal.id },
    )

    expect(res.body.errors).toBeUndefined()
    const connection = res.body.data.dealComments as Record<string, unknown>
    expect(connection['total']).toBe(2)
    const items = connection['items'] as Array<Record<string, unknown>>
    // Oldest first (ascending createdAt)
    expect(items[0]!['comment']).toBe('first comment')
    expect(items[1]!['comment']).toBe('@[Test User](user-2) second')
    expect((items[1]!['mentionedUsers'] as Array<Record<string, unknown>>)[0]!['id']).toBe('user-2')
  })

  it('enforces the author-or-admin delete rule, re-verifying the deal from the loaded row', async () => {
    const tenant = await createTenant('Acme')
    await createUser(tenant.id, 'rep-a')
    await createUser(tenant.id, 'rep-b')
    await createUser(tenant.id, 'admin-1')
    const deal = await seedDealFixture(tenant, 'rep-a')
    await createRole(tenant.id, 'role-rep', 'SALES_REP', 'OWN')
    await grantPermission('role-rep', 'DEAL', 'READ')
    await grantPermission('role-rep', 'DEAL', 'UPDATE')
    await assignRole('rep-a', 'role-rep')
    await assignRole('rep-b', 'role-rep')
    // rep-a additionally sees all deals (second role, ALL visibility) so the
    // shared-deal scenario below can exercise the ForbiddenException — the
    // JWT roles still say SALES_REP, so the author-or-admin check applies.
    await createRole(tenant.id, 'role-all', 'SALES_VIEW_ALL', 'ALL')
    await assignRole('rep-a', 'role-all')
    // ADMIN needs a DB role row too — resolveVisibilityFilter reads roles from
    // the DB, not the JWT.
    await createRole(tenant.id, 'role-admin', 'ADMIN', 'ALL')
    await assignRole('admin-1', 'role-admin')

    const created = await graphqlRequest(
      tokenFor(tenant.id, 'rep-a', ['SALES_REP']),
      `mutation ($input: AddDealCommentInput!) { addDealComment(input: $input) { id userId } }`,
      { input: { dealId: deal.id, comment: 'owned by rep-a' } },
    )
    expect(created.body.errors).toBeUndefined()
    const commentId = (created.body.data.addDealComment as { id: string }).id

    // rep-b (not the author, no ADMIN) is forbidden — and the deal is not even
    // visible to rep-b under OWN visibility, so Deal not found comes first.
    const colleagueDelete = await graphqlRequest(
      tokenFor(tenant.id, 'rep-b', ['SALES_REP']),
      `mutation ($id: ID!) { deleteDealComment(id: $id) }`,
      { id: commentId },
    )
    expect(colleagueDelete.body.errors?.[0]?.message).toBe('Deal not found')

    // A colleague on a VISIBLE deal is forbidden with the specific message.
    const sharedDeal = await createDeal(
      tenant.id,
      (await createDealStage(tenant.id, 'Qualified', 1)).id,
      (await createContact(tenant.id, 'rep-a')).id,
      'rep-b',
    )
    const onShared = await graphqlRequest(
      tokenFor(tenant.id, 'rep-b', ['SALES_REP']),
      `mutation ($input: AddDealCommentInput!) { addDealComment(input: $input) { id userId } }`,
      { input: { dealId: sharedDeal.id, comment: 'rep-bs comment on own deal' } },
    )
    expect(onShared.body.errors).toBeUndefined()
    const sharedCommentId = (onShared.body.data.addDealComment as { id: string }).id
    const repADeletesRepB = await graphqlRequest(
      tokenFor(tenant.id, 'rep-a', ['SALES_REP']),
      `mutation ($id: ID!) { deleteDealComment(id: $id) }`,
      { id: sharedCommentId },
    )
    expect(repADeletesRepB.body.errors?.[0]?.message).toBe('You can only delete your own comments')

    // The author deletes their own comment; the row soft-deletes.
    const ownDelete = await graphqlRequest(
      tokenFor(tenant.id, 'rep-a', ['SALES_REP']),
      `mutation ($id: ID!) { deleteDealComment(id: $id) }`,
      { id: commentId },
    )
    expect(ownDelete.body.errors).toBeUndefined()
    expect(ownDelete.body.data.deleteDealComment).toBe(true)
    const row = await prisma.dealComment.findFirst({ where: { id: commentId } })
    expect(row!.deletedAt).not.toBeNull()

    // ADMIN can delete anyone's comment.
    const adminDelete = await graphqlRequest(
      tokenFor(tenant.id, 'admin-1'),
      `mutation ($id: ID!) { deleteDealComment(id: $id) }`,
      { id: sharedCommentId },
    )
    expect(adminDelete.body.errors).toBeUndefined()
    expect(adminDelete.body.data.deleteDealComment).toBe(true)
  })

  it('returns mention candidates ordered by first name and filtered by search', async () => {
    const tenant = await createTenant('Acme')
    await createUser(tenant.id, 'admin-1')
    await prisma.user.update({ where: { id: 'admin-1' }, data: { firstName: 'Zoe' } })
    await createUser(tenant.id, 'user-a')
    await prisma.user.update({
      where: { id: 'user-a' },
      data: { firstName: 'Alice', lastName: 'Nguyen', email: 'alice@example.com' },
    })
    await createUser(tenant.id, 'user-b')
    await prisma.user.update({
      where: { id: 'user-b' },
      data: { firstName: 'Bob', lastName: 'Tran', email: 'bob@example.com' },
    })
    const deal = await seedDealFixture(tenant, 'admin-1')
    const token = tokenFor(tenant.id, 'admin-1')

    const all = await graphqlRequest(
      token,
      `query ($dealId: ID!) { dealMentionCandidates(dealId: $dealId) { id firstName } }`,
      { dealId: deal.id },
    )
    expect(all.body.errors).toBeUndefined()
    const candidates = all.body.data.dealMentionCandidates as Array<Record<string, unknown>>
    expect(candidates.map((c) => c['firstName'])).toEqual(['Alice', 'Bob', 'Zoe'])

    const filtered = await graphqlRequest(
      token,
      `query ($dealId: ID!, $search: String) { dealMentionCandidates(dealId: $dealId, search: $search) { id firstName lastName email } }`,
      { dealId: deal.id, search: 'ALICE' },
    )
    expect(filtered.body.errors).toBeUndefined()
    const filteredCandidates = filtered.body.data.dealMentionCandidates as Array<
      Record<string, unknown>
    >
    expect(filteredCandidates).toHaveLength(1)
    expect(filteredCandidates[0]!['firstName']).toBe('Alice')
  })
})
