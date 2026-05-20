import { execFileSync } from 'child_process'
import * as path from 'path'

import { INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { JwtService } from '@nestjs/jwt'
import { PrismaClient, UserRole } from '@prisma/client'
import request from 'supertest'
import { PostgreSqlContainer } from '@testcontainers/postgresql'

import { AppModule } from '../../src/app.module'

import type { Contact, Tenant } from '@prisma/client'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'

describe('Contact persistence tenant pattern (integration)', () => {
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
    await prisma.contact.deleteMany()
    await prisma.tenant.deleteMany()
  })

  async function createTenant(name: string): Promise<Tenant> {
    return prisma.tenant.create({ data: { name } })
  }

  function tokenFor(tenantId: string, userId: string): string {
    return jwtService.sign({
      sub: userId,
      userId,
      tenantId,
      role: UserRole.SALES_REP,
      email: `${userId}@example.com`,
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

  async function createContact(tenantId: string, email: string): Promise<Contact> {
    return prisma.contact.create({
      data: {
        tenantId,
        email,
        firstName: 'Ada',
        lastName: 'Lovelace',
        createdBy: 'test-user',
        updatedBy: 'test-user',
      },
    })
  }

  it('creates contacts with required tenant and audit fields', async () => {
    const tenant = await createTenant('Acme')

    const contact = await createContact(tenant.id, 'ada@example.com')

    expect(contact.tenantId).toBe(tenant.id)
    expect(contact.email).toBe('ada@example.com')
    expect(contact.createdAt).toBeInstanceOf(Date)
    expect(contact.updatedAt).toBeInstanceOf(Date)
    expect(contact.createdBy).toBe('test-user')
    expect(contact.updatedBy).toBe('test-user')
    expect(contact.deletedAt).toBeNull()
  })

  it('allows the same contact email in different tenants', async () => {
    const tenantA = await createTenant('Tenant A')
    const tenantB = await createTenant('Tenant B')

    await expect(createContact(tenantA.id, 'same@example.com')).resolves.toBeTruthy()
    await expect(createContact(tenantB.id, 'same@example.com')).resolves.toBeTruthy()
  })

  it('rejects duplicate contact email within the same tenant', async () => {
    const tenant = await createTenant('Tenant A')

    await createContact(tenant.id, 'duplicate@example.com')

    await expect(createContact(tenant.id, 'duplicate@example.com')).rejects.toThrow()
  })

  it('excludes soft-deleted contacts from active tenant queries', async () => {
    const tenant = await createTenant('Acme')
    const contact = await createContact(tenant.id, 'deleted@example.com')

    await prisma.contact.update({
      where: { id: contact.id },
      data: { deletedAt: new Date(), updatedBy: 'test-user' },
    })

    const activeContacts = await prisma.contact.findMany({
      where: { tenantId: tenant.id, deletedAt: null },
    })
    const storedContact = await prisma.contact.findUnique({ where: { id: contact.id } })

    expect(activeContacts).toHaveLength(0)
    expect(storedContact?.deletedAt).toBeInstanceOf(Date)
  })

  it('allows recreating an active contact after soft delete', async () => {
    const tenant = await createTenant('Acme')
    const contact = await createContact(tenant.id, 'restore@example.com')

    await prisma.contact.update({
      where: { id: contact.id },
      data: { deletedAt: new Date(), updatedBy: 'test-user' },
    })

    await expect(createContact(tenant.id, 'restore@example.com')).resolves.toBeTruthy()
  })

  it('returns only contacts for the requested tenant', async () => {
    const tenantA = await createTenant('Tenant A')
    const tenantB = await createTenant('Tenant B')
    await createContact(tenantA.id, 'a@example.com')
    await createContact(tenantB.id, 'b@example.com')

    const tenantAContacts = await prisma.contact.findMany({
      where: { tenantId: tenantA.id, deletedAt: null },
      select: { email: true },
    })

    expect(tenantAContacts).toEqual([{ email: 'a@example.com' }])
  })

  it('creates and queries contacts through authenticated GraphQL API', async () => {
    const tenant = await createTenant('GraphQL Tenant')
    const token = tokenFor(tenant.id, 'graphql-user')

    const createResponse = await graphqlRequest(
      token,
      `mutation CreateContact($input: CreateContactInput!) {
        createContact(input: $input) { id email firstName lastName }
      }`,
      { input: { email: 'Ada@Example.com', firstName: ' Ada ', lastName: ' Lovelace ' } },
    )

    expect(createResponse.status).toBe(200)
    expect(createResponse.body.errors).toBeUndefined()
    expect(createResponse.body.data.createContact.email).toBe('ada@example.com')
    expect(createResponse.body.data.createContact.firstName).toBe('Ada')

    const listResponse = await graphqlRequest(
      token,
      `query Contacts($filter: ContactFilterInput, $pagination: ContactPaginationInput) {
        contacts(filter: $filter, pagination: $pagination) {
          total
          items { id email firstName lastName }
        }
      }`,
      { filter: { search: 'ada' }, pagination: { page: 1, pageSize: 10 } },
    )

    expect(listResponse.status).toBe(200)
    expect(listResponse.body.errors).toBeUndefined()
    expect(listResponse.body.data.contacts.total).toBe(1)
    expect(listResponse.body.data.contacts.items).toHaveLength(1)
  })

  it('prevents cross-tenant contact access through GraphQL API', async () => {
    const tenantA = await createTenant('Tenant A')
    const tenantB = await createTenant('Tenant B')
    const contact = await createContact(tenantA.id, 'cross@example.com')
    const tenantBToken = tokenFor(tenantB.id, 'tenant-b-user')

    const response = await graphqlRequest(
      tenantBToken,
      `query Contact($id: ID!) { contact(id: $id) { id email } }`,
      { id: contact.id },
    )

    expect(response.status).toBe(200)
    expect(response.body.errors?.[0]?.message).toContain('Contact not found')
    expect(response.body.data.contact).toBeNull()
  })
})
