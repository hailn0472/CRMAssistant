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
      'TRUNCATE TABLE "ContactTag", "Tag", "Contact", "User", "UserRole", "Role", "Team", "Tenant" RESTART IDENTITY CASCADE',
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

  /** Creates a tenant plus an owning user and returns a signed token for them. */
  async function setupTenant(
    name: string,
    userId: string,
  ): Promise<{ tenant: Tenant; userId: string; token: string }> {
    const tenant = await createTenant(name)
    await createTestUser(tenant.id, userId)
    const token = jwtService.sign({
      sub: userId,
      userId,
      tenantId: tenant.id,
      roles: ['ADMIN'],
      email: `${userId}@example.com`,
    })
    return { tenant, userId, token }
  }

  async function createContact(
    tenantId: string,
    email: string,
    ownerId: string,
    overrides: { firstName?: string; lastName?: string; company?: string } = {},
  ): Promise<void> {
    await prisma.contact.create({
      data: {
        tenantId,
        email,
        firstName: overrides.firstName ?? 'Existing',
        lastName: overrides.lastName ?? 'Contact',
        company: overrides.company ?? null,
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

    it('rejects a file larger than the 10MB limit', async () => {
      const { token } = await setupTenant('Big File', 'big-file-user')
      const oversized = Buffer.alloc(10 * 1024 * 1024 + 1, 'a')

      const response = await importRequest(token, oversized)

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

      expect(response.status).toBe(201)
      expect(response.body.preview).toBe(true)
      expect(response.body.totalRows).toBe(3)
      expect(response.body.newRows).toBe(1)
      expect(response.body.duplicateRows).toBe(1)
      expect(response.body.invalidRows).toBe(1)

      // Preview must not write: only the pre-existing contact remains
      const stored = await prisma.contact.findMany({ where: { tenantId: tenant.id } })
      expect(stored).toHaveLength(1)
      expect(stored[0]?.email).toBe('existing@example.com')
    })

    it('persists rows when confirm=true and records audit fields', async () => {
      const { tenant, userId, token } = await setupTenant('Confirm Co', 'confirm-user')

      const response = await importRequest(
        token,
        csv(
          'ada@example.com,Ada,Lovelace,+84123456789,Acme Corp,CTO,',
          'grace@example.com,Grace,Hopper,,Navy,Admiral,',
        ),
        '?confirm=true',
      )

      expect(response.status).toBe(201)
      expect(response.body.imported).toBe(2)
      expect(response.body.failed).toBe(0)

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

    it('skips duplicates under the default skip strategy', async () => {
      const { tenant, userId, token } = await setupTenant('Skip Co', 'skip-user')
      await createContact(tenant.id, 'dup@example.com', userId, { firstName: 'Original' })

      const response = await importRequest(
        token,
        csv('dup@example.com,Changed,Name,,,,', 'fresh@example.com,Fresh,Person,,,,'),
        '?confirm=true',
      )

      expect(response.status).toBe(201)
      expect(response.body.imported).toBe(1)
      expect(response.body.skipped).toBe(1)

      const duplicate = await prisma.contact.findFirst({
        where: { tenantId: tenant.id, email: 'dup@example.com' },
      })
      expect(duplicate?.firstName).toBe('Original')
    })

    it('overwrites duplicates under the update strategy', async () => {
      const { tenant, userId, token } = await setupTenant('Update Co', 'update-user')
      await createContact(tenant.id, 'dup@example.com', userId, { firstName: 'Original' })

      const response = await importRequest(
        token,
        csv('dup@example.com,Updated,Name,,New Corp,,'),
        '?confirm=true&strategy=update',
      )

      expect(response.status).toBe(201)
      expect(response.body.updated).toBe(1)

      const duplicate = await prisma.contact.findFirst({
        where: { tenantId: tenant.id, email: 'dup@example.com' },
      })
      expect(duplicate?.firstName).toBe('Updated')
      expect(duplicate?.company).toBe('New Corp')
    })

    it('creates and links tags listed in the CSV', async () => {
      const { tenant, token } = await setupTenant('Tag Co', 'tag-user')

      const response = await importRequest(
        token,
        csv('tagged@example.com,Tagged,Person,,,,"VIP,Enterprise"'),
        '?confirm=true',
      )

      expect(response.status).toBe(201)

      const contact = await prisma.contact.findFirst({
        where: { tenantId: tenant.id, email: 'tagged@example.com' },
        include: { tags: { select: { tag: { select: { name: true } } } } },
      })
      expect(contact?.tags.map((t) => t.tag.name).sort()).toEqual(['Enterprise', 'VIP'])
    })

    it('scopes imported contacts to the calling tenant only', async () => {
      const tenantA = await setupTenant('Tenant A', 'tenant-a-user')
      const tenantB = await setupTenant('Tenant B', 'tenant-b-user')

      await importRequest(
        tenantA.token,
        csv('shared@example.com,Shared,Person,,,,'),
        '?confirm=true',
      )

      const inTenantA = await prisma.contact.findMany({ where: { tenantId: tenantA.tenant.id } })
      const inTenantB = await prisma.contact.findMany({ where: { tenantId: tenantB.tenant.id } })

      expect(inTenantA.map((c) => c.email)).toEqual(['shared@example.com'])
      expect(inTenantB).toHaveLength(0)
    })

    it('treats an email already used by another tenant as a new contact', async () => {
      const tenantA = await setupTenant('Tenant A', 'tenant-a-user')
      const tenantB = await setupTenant('Tenant B', 'tenant-b-user')
      await createContact(tenantA.tenant.id, 'shared@example.com', tenantA.userId)

      const response = await importRequest(
        tenantB.token,
        csv('shared@example.com,Shared,Person,,,,'),
        '?confirm=true',
      )

      expect(response.status).toBe(201)
      expect(response.body.imported).toBe(1)
      expect(response.body.skipped).toBe(0)
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

      const response = await request(app.getHttpServer())
        .get('/api/contacts/export')
        .set('Authorization', `Bearer ${tenantA.token}`)

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toContain('text/csv')
      expect(response.headers['content-disposition']).toContain('attachment; filename="contacts-')
      expect(response.text).toContain('mine@example.com')
      expect(response.text).not.toContain('theirs@example.com')
    })

    it('excludes soft-deleted contacts', async () => {
      const { tenant, userId, token } = await setupTenant('Soft Delete Co', 'soft-delete-user')
      await createContact(tenant.id, 'kept@example.com', userId)
      await createContact(tenant.id, 'removed@example.com', userId)
      await prisma.contact.updateMany({
        where: { tenantId: tenant.id, email: 'removed@example.com' },
        data: { deletedAt: new Date(), updatedBy: userId },
      })

      const response = await request(app.getHttpServer())
        .get('/api/contacts/export')
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.text).toContain('kept@example.com')
      expect(response.text).not.toContain('removed@example.com')
    })

    it('applies the company filter', async () => {
      const { tenant, userId, token } = await setupTenant('Filter Co', 'filter-user')
      await createContact(tenant.id, 'acme@example.com', userId, { company: 'Acme Corp' })
      await createContact(tenant.id, 'globex@example.com', userId, { company: 'Globex' })

      const response = await request(app.getHttpServer())
        .get('/api/contacts/export?company=acme')
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.text).toContain('acme@example.com')
      expect(response.text).not.toContain('globex@example.com')
    })

    it('applies the search filter across name and email', async () => {
      const { tenant, userId, token } = await setupTenant('Search Co', 'search-user')
      await createContact(tenant.id, 'ada@example.com', userId, { firstName: 'Ada' })
      await createContact(tenant.id, 'grace@example.com', userId, { firstName: 'Grace' })

      const response = await request(app.getHttpServer())
        .get('/api/contacts/export?search=ada')
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.text).toContain('ada@example.com')
      expect(response.text).not.toContain('grace@example.com')
    })
  })
})
