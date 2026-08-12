import { execFileSync } from 'child_process'
import * as path from 'path'

import { INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { JwtService } from '@nestjs/jwt'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { PostgreSqlContainer } from '@testcontainers/postgresql'

import { AppModule } from '../../src/app.module'
import { createValidationPipe } from '../../src/common/validation'

import type { ImportResultResponse } from '../../src/import-export/dto/import-result.dto'
import type { Tenant } from '@prisma/client'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'

const CSV_HEADER = 'email,firstName,lastName,phone,company,jobTitle,tags'

describe('Contact import/export endpoints (integration)', () => {
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
    // createNestApplication() does not run bootstrap(), so the global pipe has to
    // be applied explicitly or the tests would run without DTO validation.
    app.useGlobalPipes(createValidationPipe())
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
      'TRUNCATE TABLE "Notification", "ContactTag", "Tag", "Note", "Contact", "User", "UserRole", "Role", "Team", "Tenant" RESTART IDENTITY CASCADE',
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

  /** Creates a tenant plus an owning user and returns a signed token for them. */
  async function setupTenant(
    name: string,
    userId: string,
  ): Promise<{ tenant: Tenant; userId: string; token: string }> {
    const tenant = await createTenant(name)
    await createTestUser(tenant.id, userId)
    return { tenant, userId, token: signToken(userId, tenant.id) }
  }

  /** Grants the user a role with the given record visibility. */
  async function assignRole(
    tenantId: string,
    userId: string,
    name: string,
    dataVisibility: 'OWN' | 'TEAM' | 'ALL',
  ): Promise<void> {
    const role = await prisma.role.create({ data: { tenantId, name, dataVisibility } })
    await prisma.userRole.create({ data: { userId, roleId: role.id } })
  }

  async function createContact(
    tenantId: string,
    email: string,
    ownerId: string,
    overrides: {
      firstName?: string
      lastName?: string
      company?: string
      jobTitle?: string
    } = {},
  ): Promise<void> {
    await prisma.contact.create({
      data: {
        tenantId,
        email,
        firstName: overrides.firstName ?? 'Existing',
        lastName: overrides.lastName ?? 'Contact',
        company: overrides.company ?? null,
        jobTitle: overrides.jobTitle ?? null,
        ownerId,
        createdBy: ownerId,
        updatedBy: ownerId,
      },
    })
  }

  function csv(...rows: string[]): Buffer {
    return Buffer.from([CSV_HEADER, ...rows].join('\n'), 'utf-8')
  }

  function importRequest(token: string, file: Buffer, query = ''): request.Test {
    return request(app.getHttpServer())
      .post(`/api/contacts/import${query}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', file, { filename: 'contacts.csv', contentType: 'text/csv' })
  }

  function exportRequest(token: string, query = ''): request.Test {
    return request(app.getHttpServer())
      .get(`/api/contacts/export${query}`)
      .set('Authorization', `Bearer ${token}`)
  }

  /**
   * Confirms an import and polls the status endpoint until it settles, mirroring
   * what the frontend does.
   */
  async function runImport(
    token: string,
    file: Buffer,
    extraQuery = '',
    timeoutMs = 30_000,
  ): Promise<ImportResultResponse> {
    const started = await importRequest(token, file, `?confirm=true${extraQuery}`)
    expect(started.status).toBe(200)
    expect(started.body.importId).toEqual(expect.any(String))

    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const status = await request(app.getHttpServer())
        .get(`/api/contacts/import/${started.body.importId}/status`)
        .set('Authorization', `Bearer ${token}`)

      expect(status.status).toBe(200)
      if (status.body.status !== 'running') {
        return status.body.result as ImportResultResponse
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }

    throw new Error('Import did not finish within the timeout')
  }

  describe('POST /api/contacts/import', () => {
    it('rejects unauthenticated requests', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/contacts/import')
        .attach('file', csv('ada@example.com,Ada,Lovelace,,,,'), {
          filename: 'contacts.csv',
          contentType: 'text/csv',
        })

      expect(response.status).toBe(401)
    })

    it('rejects a request with no file attached', async () => {
      const { token } = await setupTenant('No File', 'no-file-user')

      const response = await request(app.getHttpServer())
        .post('/api/contacts/import')
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(400)
    })

    it('rejects a file larger than the 10MB limit with 413', async () => {
      const { token } = await setupTenant('Big File', 'big-file-user')
      const oversized = Buffer.alloc(10 * 1024 * 1024 + 1, 'a')

      const response = await importRequest(token, oversized)

      expect(response.status).toBe(413)
    })

    it('rejects a non-CSV upload', async () => {
      const { token } = await setupTenant('Bad Type', 'bad-type-user')

      const response = await request(app.getHttpServer())
        .post('/api/contacts/import')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('not a csv'), {
          filename: 'payload.pdf',
          contentType: 'application/pdf',
        })

      expect(response.status).toBe(400)
      expect(response.body.message).toContain('Only .csv and .tsv')
    })

    it('rejects a malformed CSV with 400 and a descriptive message', async () => {
      const { token } = await setupTenant('Malformed', 'malformed-user')
      const missingColumn = Buffer.from('email,firstName\na@example.com,A', 'utf-8')

      const response = await importRequest(token, missingColumn)

      expect(response.status).toBe(400)
      expect(response.body.message).toContain('missing required column "lastName"')
    })

    it('rejects an unrecognised strategy instead of silently importing nothing', async () => {
      const { token } = await setupTenant('Bad Strategy', 'bad-strategy-user')

      const response = await importRequest(
        token,
        csv('a@example.com,A,B,,,,'),
        '?confirm=true&strategy=merge',
      )

      expect(response.status).toBe(400)
    })

    it('previews new, duplicate and invalid rows without persisting anything', async () => {
      const { tenant, userId, token } = await setupTenant('Preview Co', 'preview-user')
      await createContact(tenant.id, 'existing@example.com', userId)

      const response = await importRequest(
        token,
        csv(
          'new@example.com,New,Person,,,,',
          'existing@example.com,Existing,Person,,,,',
          ',Missing,Email,,,,',
        ),
      )

      expect(response.status).toBe(200)
      expect(response.body.preview).toBe(true)
      expect(response.body.totalRows).toBe(3)
      expect(response.body.newRows).toBe(1)
      expect(response.body.duplicateRows).toBe(1)
      expect(response.body.invalidRows).toBe(1)

      // Duplicates must carry the existing record so the user can compare.
      const duplicate = response.body.previewRows.find(
        (r: { status: string }) => r.status === 'duplicate',
      )
      expect(duplicate.existingContact.email).toBe('existing@example.com')

      // Preview must not write: only the pre-existing contact remains
      const stored = await prisma.contact.findMany({ where: { tenantId: tenant.id } })
      expect(stored).toHaveLength(1)
      expect(stored[0]?.email).toBe('existing@example.com')
    })

    it('persists rows when confirm=true and records audit fields', async () => {
      const { tenant, userId, token } = await setupTenant('Confirm Co', 'confirm-user')

      const result = await runImport(
        token,
        csv(
          'ada@example.com,Ada,Lovelace,+84123456789,Acme Corp,CTO,',
          'grace@example.com,Grace,Hopper,,Navy,Admiral,',
        ),
      )

      expect(result.imported).toBe(2)
      expect(result.failed).toBe(0)

      const stored = await prisma.contact.findMany({
        where: { tenantId: tenant.id },
        orderBy: { email: 'asc' },
      })
      expect(stored.map((c) => c.email)).toEqual(['ada@example.com', 'grace@example.com'])
      expect(stored[0]?.firstName).toBe('Ada')
      expect(stored[0]?.company).toBe('Acme Corp')
      expect(stored[0]?.ownerId).toBe(userId)
      expect(stored[0]?.createdBy).toBe(userId)
    })

    it('writes an audit log entry for the import', async () => {
      const { tenant, userId, token } = await setupTenant('Audit Co', 'audit-user')

      await runImport(token, csv('audited@example.com,Aud,Ited,,,,'))

      const entry = await prisma.auditLog.findFirst({
        where: { tenantId: tenant.id, action: 'CONTACT_IMPORTED' },
      })
      expect(entry).not.toBeNull()
      expect(entry?.userId).toBe(userId)
      expect(entry?.details).toMatchObject({ imported: 1, strategy: 'skip' })
    })

    it('reports invalid rows against the line number in the user file', async () => {
      const { token } = await setupTenant('Lines Co', 'lines-user')

      const result = await runImport(token, csv('ok@example.com,A,B,,,,', 'not-an-email,C,D,,,,'))

      expect(result.imported).toBe(1)
      // Line 1 is the header, so the bad row is line 3.
      expect(result.errors).toContainEqual({ row: 3, reason: 'Invalid email format' })
    })

    it('skips duplicates under the default skip strategy', async () => {
      const { tenant, userId, token } = await setupTenant('Skip Co', 'skip-user')
      await createContact(tenant.id, 'dup@example.com', userId, { firstName: 'Original' })

      const result = await runImport(
        token,
        csv('dup@example.com,Changed,Name,,,,', 'fresh@example.com,Fresh,Person,,,,'),
      )

      expect(result.imported).toBe(1)
      expect(result.skipped).toBe(1)

      const duplicate = await prisma.contact.findFirst({
        where: { tenantId: tenant.id, email: 'dup@example.com' },
      })
      expect(duplicate?.firstName).toBe('Original')
    })

    it('matches duplicates case-insensitively against stored emails', async () => {
      const { tenant, userId, token } = await setupTenant('Case Co', 'case-user')
      // Seeded with mixed casing, as an older import could have stored it.
      await prisma.contact.create({
        data: {
          tenantId: tenant.id,
          email: 'John@Example.COM',
          firstName: 'John',
          lastName: 'Doe',
          ownerId: userId,
          createdBy: userId,
          updatedBy: userId,
        },
      })

      const result = await runImport(token, csv('john@example.com,John,Doe,,,,'))

      expect(result.skipped).toBe(1)
      expect(result.imported).toBe(0)
      const stored = await prisma.contact.findMany({ where: { tenantId: tenant.id } })
      expect(stored).toHaveLength(1)
    })

    it('overwrites duplicates under the update strategy', async () => {
      const { tenant, userId, token } = await setupTenant('Update Co', 'update-user')
      await createContact(tenant.id, 'dup@example.com', userId, { firstName: 'Original' })

      const result = await runImport(
        token,
        csv('dup@example.com,Updated,Name,,New Corp,,'),
        '&strategy=update',
      )

      expect(result.updated).toBe(1)

      const duplicate = await prisma.contact.findFirst({
        where: { tenantId: tenant.id, email: 'dup@example.com' },
      })
      expect(duplicate?.firstName).toBe('Updated')
      expect(duplicate?.company).toBe('New Corp')
    })

    it('leaves columns absent from the CSV untouched under the update strategy', async () => {
      const { tenant, userId, token } = await setupTenant('Partial Co', 'partial-user')
      await createContact(tenant.id, 'partial@example.com', userId, {
        company: 'Keep Corp',
        jobTitle: 'Keep Title',
      })

      const partial = Buffer.from(
        ['email,firstName,lastName', 'partial@example.com,New,Name'].join('\n'),
        'utf-8',
      )
      const result = await runImport(token, partial, '&strategy=update')

      expect(result.updated).toBe(1)
      const contact = await prisma.contact.findFirst({
        where: { tenantId: tenant.id, email: 'partial@example.com' },
      })
      expect(contact?.firstName).toBe('New')
      expect(contact?.company).toBe('Keep Corp')
      expect(contact?.jobTitle).toBe('Keep Title')
    })

    it('reports existing emails as failures under the create_new strategy', async () => {
      const { tenant, userId, token } = await setupTenant('Create New Co', 'create-new-user')
      await createContact(tenant.id, 'dup@example.com', userId)

      const result = await runImport(
        token,
        csv('dup@example.com,Dup,Person,,,,', 'brand@example.com,Brand,New,,,,'),
        '&strategy=create_new',
      )

      expect(result.imported).toBe(1)
      expect(result.failed).toBe(1)
      expect(result.errors).toContainEqual({ row: 2, reason: 'Email already exists' })

      const stored = await prisma.contact.findMany({ where: { tenantId: tenant.id } })
      expect(stored).toHaveLength(2)
    })

    it('refuses to update a contact the caller has no edit rights to', async () => {
      const tenant = await createTenant('ACL Co')
      await createTestUser(tenant.id, 'owner-user')
      await createTestUser(tenant.id, 'other-user')
      await assignRole(tenant.id, 'other-user', 'SALES', 'OWN')
      await createContact(tenant.id, 'owned@example.com', 'owner-user', { firstName: 'Original' })

      const result = await runImport(
        signToken('other-user', tenant.id, ['SALES']),
        csv('owned@example.com,Hijacked,Name,,,,'),
        '&strategy=update',
      )

      expect(result.updated).toBe(0)
      expect(result.errors[0]?.reason).toContain('Insufficient permissions')

      const contact = await prisma.contact.findFirst({
        where: { tenantId: tenant.id, email: 'owned@example.com' },
      })
      expect(contact?.firstName).toBe('Original')
    })

    it('creates and links tags listed in the CSV', async () => {
      const { tenant, token } = await setupTenant('Tag Co', 'tag-user')

      await runImport(token, csv('tagged@example.com,Tagged,Person,,,,"VIP,Enterprise"'))

      const contact = await prisma.contact.findFirst({
        where: { tenantId: tenant.id, email: 'tagged@example.com' },
        include: { tags: { select: { tag: { select: { name: true } } } } },
      })
      expect(contact?.tags.map((t) => t.tag.name).sort()).toEqual(['Enterprise', 'VIP'])
    })

    it('reuses an existing tag rather than failing on the unique constraint', async () => {
      const { tenant, token } = await setupTenant('Tag Reuse Co', 'tag-reuse-user')
      await prisma.tag.create({ data: { tenantId: tenant.id, name: 'VIP' } })

      const result = await runImport(
        token,
        csv('a@example.com,A,B,,,,VIP', 'c@example.com,C,D,,,,VIP'),
      )

      expect(result.imported).toBe(2)
      expect(result.failed).toBe(0)
      const tags = await prisma.tag.findMany({ where: { tenantId: tenant.id, name: 'VIP' } })
      expect(tags).toHaveLength(1)
    })

    it('scopes imported contacts to the calling tenant only', async () => {
      const tenantA = await setupTenant('Tenant A', 'tenant-a-user')
      const tenantB = await setupTenant('Tenant B', 'tenant-b-user')

      await runImport(tenantA.token, csv('shared@example.com,Shared,Person,,,,'))

      const inTenantA = await prisma.contact.findMany({ where: { tenantId: tenantA.tenant.id } })
      const inTenantB = await prisma.contact.findMany({ where: { tenantId: tenantB.tenant.id } })

      expect(inTenantA.map((c) => c.email)).toEqual(['shared@example.com'])
      expect(inTenantB).toHaveLength(0)
    })

    it('treats an email already used by another tenant as a new contact', async () => {
      const tenantA = await setupTenant('Tenant A', 'tenant-a-user')
      const tenantB = await setupTenant('Tenant B', 'tenant-b-user')
      await createContact(tenantA.tenant.id, 'shared@example.com', tenantA.userId)

      const result = await runImport(tenantB.token, csv('shared@example.com,Shared,Person,,,,'))

      expect(result.imported).toBe(1)
      expect(result.skipped).toBe(0)
    })

    it('imports 500 contacts in under 15 seconds', async () => {
      const { tenant, token } = await setupTenant('Perf Co', 'perf-user')
      const rows = Array.from(
        { length: 500 },
        (_, i) => `perf${i}@example.com,User${i},Perf,,Acme,Engineer,`,
      )

      const started = Date.now()
      const result = await runImport(token, csv(...rows))
      const elapsed = Date.now() - started

      expect(result.imported).toBe(500)
      expect(result.failed).toBe(0)
      expect(elapsed).toBeLessThan(15_000)

      const count = await prisma.contact.count({ where: { tenantId: tenant.id } })
      expect(count).toBe(500)
    }, 30_000)
  })

  describe('GET /api/contacts/import/:importId/status', () => {
    it("does not expose another tenant's import", async () => {
      const tenantA = await setupTenant('Tenant A', 'tenant-a-user')
      const tenantB = await setupTenant('Tenant B', 'tenant-b-user')

      const started = await importRequest(
        tenantA.token,
        csv('a@example.com,A,B,,,,'),
        '?confirm=true',
      )

      const response = await request(app.getHttpServer())
        .get(`/api/contacts/import/${started.body.importId}/status`)
        .set('Authorization', `Bearer ${tenantB.token}`)

      expect(response.status).toBe(404)
    })
  })

  describe('GET /api/contacts/import/template', () => {
    it('returns a CSV template containing the required columns', async () => {
      const { token } = await setupTenant('Template Co', 'template-user')

      const response = await request(app.getHttpServer())
        .get('/api/contacts/import/template')
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.template).toContain('email,firstName,lastName')
    })
  })

  describe('GET /api/contacts/export', () => {
    it('rejects unauthenticated requests', async () => {
      const response = await request(app.getHttpServer()).get('/api/contacts/export')

      expect(response.status).toBe(401)
    })

    it('returns CSV containing only the calling tenant contacts', async () => {
      const tenantA = await setupTenant('Tenant A', 'tenant-a-user')
      const tenantB = await setupTenant('Tenant B', 'tenant-b-user')
      await createContact(tenantA.tenant.id, 'mine@example.com', tenantA.userId)
      await createContact(tenantB.tenant.id, 'theirs@example.com', tenantB.userId)

      const response = await exportRequest(tenantA.token)

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toContain('text/csv')
      expect(response.headers['content-disposition']).toContain('attachment; filename="contacts-')
      expect(response.text).toContain('mine@example.com')
      expect(response.text).not.toContain('theirs@example.com')
    })

    it('restricts a user with OWN visibility to their own records', async () => {
      const tenant = await createTenant('Visibility Co')
      await createTestUser(tenant.id, 'rep-user')
      await createTestUser(tenant.id, 'colleague-user')
      await assignRole(tenant.id, 'rep-user', 'SALES', 'OWN')
      await createContact(tenant.id, 'mine@example.com', 'rep-user')
      await createContact(tenant.id, 'colleague@example.com', 'colleague-user')

      const response = await exportRequest(signToken('rep-user', tenant.id, ['SALES']))

      expect(response.status).toBe(200)
      expect(response.text).toContain('mine@example.com')
      // Exporting the whole tenant regardless of visibility would leak here.
      expect(response.text).not.toContain('colleague@example.com')
    })

    it('lets a user with ALL visibility export the whole tenant', async () => {
      const tenant = await createTenant('Manager Co')
      await createTestUser(tenant.id, 'manager-user')
      await createTestUser(tenant.id, 'colleague-user')
      await assignRole(tenant.id, 'manager-user', 'MANAGER', 'ALL')
      await createContact(tenant.id, 'mine@example.com', 'manager-user')
      await createContact(tenant.id, 'colleague@example.com', 'colleague-user')

      const response = await exportRequest(signToken('manager-user', tenant.id, ['MANAGER']))

      expect(response.status).toBe(200)
      expect(response.text).toContain('mine@example.com')
      expect(response.text).toContain('colleague@example.com')
    })

    it('emits headers only for an empty tenant', async () => {
      const { token } = await setupTenant('Empty Co', 'empty-user')

      const response = await exportRequest(token)

      expect(response.status).toBe(200)
      expect(response.text.trim()).toBe(
        'id,email,firstName,lastName,phone,company,jobTitle,tags,createdAt,updatedAt',
      )
    })

    it('excludes soft-deleted contacts', async () => {
      const { tenant, userId, token } = await setupTenant('Soft Delete Co', 'soft-delete-user')
      await createContact(tenant.id, 'kept@example.com', userId)
      await createContact(tenant.id, 'removed@example.com', userId)
      await prisma.contact.updateMany({
        where: { tenantId: tenant.id, email: 'removed@example.com' },
        data: { deletedAt: new Date(), updatedBy: userId },
      })

      const response = await exportRequest(token)

      expect(response.status).toBe(200)
      expect(response.text).toContain('kept@example.com')
      expect(response.text).not.toContain('removed@example.com')
    })

    it('applies the company filter', async () => {
      const { tenant, userId, token } = await setupTenant('Filter Co', 'filter-user')
      await createContact(tenant.id, 'acme@example.com', userId, { company: 'Acme Corp' })
      await createContact(tenant.id, 'globex@example.com', userId, { company: 'Globex' })

      const response = await exportRequest(token, '?company=acme')

      expect(response.status).toBe(200)
      expect(response.text).toContain('acme@example.com')
      expect(response.text).not.toContain('globex@example.com')
    })

    it('applies the jobTitle filter', async () => {
      const { tenant, userId, token } = await setupTenant('Title Co', 'title-user')
      await createContact(tenant.id, 'cto@example.com', userId, { jobTitle: 'CTO' })
      await createContact(tenant.id, 'sales@example.com', userId, { jobTitle: 'Sales Manager' })

      const response = await exportRequest(token, '?jobTitle=cto')

      expect(response.status).toBe(200)
      expect(response.text).toContain('cto@example.com')
      expect(response.text).not.toContain('sales@example.com')
    })

    it('applies the search filter across name and email', async () => {
      const { tenant, userId, token } = await setupTenant('Search Co', 'search-user')
      await createContact(tenant.id, 'ada@example.com', userId, { firstName: 'Ada' })
      await createContact(tenant.id, 'grace@example.com', userId, { firstName: 'Grace' })

      const response = await exportRequest(token, '?search=ada')

      expect(response.status).toBe(200)
      expect(response.text).toContain('ada@example.com')
      expect(response.text).not.toContain('grace@example.com')
    })

    it('rejects an unsupported export format', async () => {
      const { token } = await setupTenant('Format Co', 'format-user')

      const response = await exportRequest(token, '?format=xlsx')

      expect(response.status).toBe(400)
    })

    it('includes imported tags in the exported CSV', async () => {
      const { token } = await setupTenant('Tag Export Co', 'tag-export-user')
      await runImport(token, csv('tagged@example.com,Tagged,Person,,,,"VIP,Enterprise"'))

      const response = await exportRequest(token)

      expect(response.status).toBe(200)
      const row = response.text.split('\n').find((line) => line.includes('tagged@example.com'))!
      // Tags share one column, semicolon-separated (no quoting needed since a
      // semicolon is not the field delimiter).
      expect(row).toMatch(/,(VIP;Enterprise|Enterprise;VIP),/)
    })

    it('filters the export by tag', async () => {
      const { token } = await setupTenant('Tag Filter Co', 'tag-filter-user')
      await runImport(
        token,
        csv('vip@example.com,Vip,Person,,,,VIP', 'plain@example.com,Plain,Person,,,,'),
      )

      const response = await exportRequest(token, '?tags=VIP')

      expect(response.status).toBe(200)
      expect(response.text).toContain('vip@example.com')
      expect(response.text).not.toContain('plain@example.com')
    })
  })

  describe('import -> export round trip', () => {
    it('exports the same values that were imported, including escaped fields', async () => {
      const { token } = await setupTenant('Round Trip Co', 'round-trip-user')

      const original = csv(
        'ada@example.com,Ada,Lovelace,+84123456789,"Acme, Inc",CTO,VIP',
        'grace@example.com,Grace,Hopper,,"Navy ""Fleet""",Admiral,',
      )
      const result = await runImport(token, original)
      expect(result.imported).toBe(2)

      const response = await exportRequest(token)
      expect(response.status).toBe(200)

      const ada = response.text.split('\n').find((l) => l.includes('ada@example.com'))!
      const grace = response.text.split('\n').find((l) => l.includes('grace@example.com'))!

      // A comma inside a value survives as a quoted field.
      expect(ada).toContain('"Acme, Inc"')
      expect(ada).toContain('+84123456789')
      expect(ada).toContain('VIP')
      // A literal quote survives as an RFC 4180 doubled quote.
      expect(grace).toContain('"Navy ""Fleet"""')
    })

    it('re-imports its own export without corrupting or duplicating anything', async () => {
      const { tenant, token } = await setupTenant('Reimport Co', 'reimport-user')
      await runImport(token, csv('ada@example.com,Ada,Lovelace,,"Acme, Inc",CTO,'))

      const exported = await exportRequest(token)
      // The export carries extra id/createdAt/updatedAt columns the importer ignores.
      const secondImport = await runImport(token, Buffer.from(exported.text, 'utf-8'))

      // Every row is recognised as an existing contact, not created afresh.
      expect(secondImport.skipped).toBe(1)
      expect(secondImport.imported).toBe(0)

      const stored = await prisma.contact.findMany({ where: { tenantId: tenant.id } })
      expect(stored).toHaveLength(1)
      expect(stored[0]?.company).toBe('Acme, Inc')
    })
  })
})
