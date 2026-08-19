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

describe('Deals persistence tenant pattern (integration)', () => {
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
      'TRUNCATE TABLE "CustomerAnalyticsSnapshot", "Notification", "Widget", "Dashboard", "Deal", "DealStage", "Note", "Contact", "User", "UserRole", "Role", "Team", "Report", "Tenant" RESTART IDENTITY CASCADE',
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
    email: string,
    ownerId = 'test-user',
  ): Promise<{ id: string }> {
    return prisma.contact.create({
      data: {
        tenantId,
        email,
        firstName: 'Ada',
        lastName: 'Lovelace',
        ownerId,
        createdBy: ownerId,
        updatedBy: ownerId,
      },
      select: { id: true },
    })
  }

  function tokenFor(tenantId: string, userId: string): string {
    return jwtService.sign({
      sub: userId,
      userId,
      tenantId,
      roles: ['ADMIN'],
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

  it('creates deals with required tenant and audit fields', async () => {
    const tenant = await createTenant('Acme')
    await createTestUser(tenant.id, 'test-user')
    const stage = await createDealStage(tenant.id, 'Qualified', 1)
    const contact = await createContact(tenant.id, 'ada@example.com')

    const deal = await prisma.deal.create({
      data: {
        tenantId: tenant.id,
        title: 'Enterprise Deal',
        value: 100000,
        stageId: stage.id,
        contactId: contact.id,
        ownerId: 'test-user',
        createdBy: 'test-user',
        updatedBy: 'test-user',
      },
    })

    expect(deal.tenantId).toBe(tenant.id)
    expect(deal.title).toBe('Enterprise Deal')
    expect(deal.value).toBe(100000)
    expect(deal.currency).toBe('USD')
    expect(deal.stageId).toBe(stage.id)
    expect(deal.contactId).toBe(contact.id)
    expect(deal.ownerId).toBe('test-user')
    expect(deal.createdAt).toBeInstanceOf(Date)
    expect(deal.updatedAt).toBeInstanceOf(Date)
    expect(deal.deletedAt).toBeNull()
  })

  it('enforces multi-tenancy — same deal title allowed in different tenants', async () => {
    const tenantA = await createTenant('Tenant A')
    const tenantB = await createTenant('Tenant B')
    await createTestUser(tenantA.id, 'user-A')
    await createTestUser(tenantB.id, 'user-B')
    const stageA = await createDealStage(tenantA.id, 'First', 1)
    const stageB = await createDealStage(tenantB.id, 'First', 1)
    const contactA = await createContact(tenantA.id, 'a@example.com', 'user-A')
    const contactB = await createContact(tenantB.id, 'b@example.com', 'user-B')

    const dealA = await prisma.deal.create({
      data: {
        tenantId: tenantA.id,
        title: 'Same Deal',
        stageId: stageA.id,
        contactId: contactA.id,
        ownerId: 'user-A',
        createdBy: 'user-A',
        updatedBy: 'user-A',
      },
    })
    const dealB = await prisma.deal.create({
      data: {
        tenantId: tenantB.id,
        title: 'Same Deal',
        stageId: stageB.id,
        contactId: contactB.id,
        ownerId: 'user-B',
        createdBy: 'user-B',
        updatedBy: 'user-B',
      },
    })

    expect(dealA.tenantId).toBe(tenantA.id)
    expect(dealB.tenantId).toBe(tenantB.id)
  })

  it('excludes soft-deleted deals from active tenant queries', async () => {
    const tenant = await createTenant('Acme')
    await createTestUser(tenant.id, 'test-user')
    const stage = await createDealStage(tenant.id, 'Qualified', 1)
    const contact = await createContact(tenant.id, 'ada@example.com')

    const deal = await prisma.deal.create({
      data: {
        tenantId: tenant.id,
        title: 'To Delete',
        stageId: stage.id,
        contactId: contact.id,
        ownerId: 'test-user',
        createdBy: 'test-user',
        updatedBy: 'test-user',
      },
    })

    await prisma.deal.update({
      where: { id: deal.id },
      data: { deletedAt: new Date(), updatedBy: 'test-user' },
    })

    const activeDeals = await prisma.deal.findMany({
      where: { tenantId: tenant.id, deletedAt: null },
    })
    const storedDeal = await prisma.deal.findUnique({ where: { id: deal.id } })

    expect(activeDeals).toHaveLength(0)
    expect(storedDeal?.deletedAt).toBeInstanceOf(Date)
  })

  it('creates and queries deals through authenticated GraphQL API', async () => {
    const tenant = await createTenant('GraphQL Tenant')
    const userId = 'graphql-user'
    await createTestUser(tenant.id, userId)
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
    await prisma.userRole.create({ data: { userId, roleId: role.id, assignedBy: 'test' } })
    const stage = await createDealStage(tenant.id, 'Prospecting', 1, 10)
    const contact = await createContact(tenant.id, 'client@example.com', userId)

    // Grant DEAL permissions
    const dealCreatePerm = await prisma.permission.create({
      data: { resource: 'DEAL', action: 'CREATE', description: '' },
    })
    const dealReadPerm = await prisma.permission.create({
      data: { resource: 'DEAL', action: 'READ', description: '' },
    })
    const dealUpdatePerm = await prisma.permission.create({
      data: { resource: 'DEAL', action: 'UPDATE', description: '' },
    })
    const dealDeletePerm = await prisma.permission.create({
      data: { resource: 'DEAL', action: 'DELETE', description: '' },
    })
    await prisma.rolePermission.create({
      data: { roleId: role.id, permissionId: dealCreatePerm.id },
    })
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: dealReadPerm.id } })
    await prisma.rolePermission.create({
      data: { roleId: role.id, permissionId: dealUpdatePerm.id },
    })
    await prisma.rolePermission.create({
      data: { roleId: role.id, permissionId: dealDeletePerm.id },
    })

    const token = tokenFor(tenant.id, userId)

    const createResponse = await graphqlRequest(
      token,
      `mutation CreateDeal($input: CreateDealInput!) {
        createDeal(input: $input) { id title value stageId contactId }
      }`,
      {
        input: {
          title: 'Big Deal',
          stageId: stage.id,
          contactId: contact.id,
          value: 50000,
        },
      },
    )

    expect(createResponse.status).toBe(200)
    expect(createResponse.body.errors).toBeUndefined()
    expect(createResponse.body.data.createDeal.title).toBe('Big Deal')
    expect(createResponse.body.data.createDeal.value).toBe(50000)

    const dealId = createResponse.body.data.createDeal.id

    // Query single deal
    const queryResponse = await graphqlRequest(
      token,
      `query Deal($id: ID!) { deal(id: $id) { id title value stage { id name } } }`,
      { id: dealId },
    )

    expect(queryResponse.status).toBe(200)
    expect(queryResponse.body.errors).toBeUndefined()
    expect(queryResponse.body.data.deal.title).toBe('Big Deal')

    // Update deal
    const updateResponse = await graphqlRequest(
      token,
      `mutation UpdateDeal($id: ID!, $input: UpdateDealInput!) {
        updateDeal(id: $id, input: $input) { id title value }
      }`,
      { id: dealId, input: { title: 'Updated Deal', value: 75000 } },
    )

    expect(updateResponse.status).toBe(200)
    expect(updateResponse.body.errors).toBeUndefined()
    expect(updateResponse.body.data.updateDeal.title).toBe('Updated Deal')
    expect(updateResponse.body.data.updateDeal.value).toBe(75000)

    // Move to another stage
    const stage2 = await createDealStage(tenant.id, 'Qualified', 2, 25)
    const moveResponse = await graphqlRequest(
      token,
      `mutation MoveDeal($dealId: ID!, $stageId: ID!) {
        moveDealToStage(dealId: $dealId, stageId: $stageId) { id stageId }
      }`,
      { dealId, stageId: stage2.id },
    )

    expect(moveResponse.status).toBe(200)
    expect(moveResponse.body.errors).toBeUndefined()
    expect(moveResponse.body.data.moveDealToStage.stageId).toBe(stage2.id)

    // List deals
    const listResponse = await graphqlRequest(
      token,
      `query Deals($filter: DealFilterInput, $pagination: DealPaginationInput) {
        deals(filter: $filter, pagination: $pagination) { total items { id title } }
      }`,
      { filter: { search: 'Updated' }, pagination: { page: 1, pageSize: 10 } },
    )

    expect(listResponse.status).toBe(200)
    expect(listResponse.body.errors).toBeUndefined()
    expect(listResponse.body.data.deals.total).toBe(1)
    expect(listResponse.body.data.deals.items).toHaveLength(1)
  })

  it('prevents cross-tenant deal access through GraphQL API', async () => {
    const tenantA = await createTenant('Tenant A')
    const tenantB = await createTenant('Tenant B')
    await createTestUser(tenantA.id, 'user-a')
    await createTestUser(tenantB.id, 'user-b')

    const roleA = await prisma.role.create({
      data: {
        tenantId: tenantA.id,
        name: 'ADMIN',
        isSystem: true,
        dataVisibility: 'ALL',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    await prisma.userRole.create({
      data: { userId: 'user-a', roleId: roleA.id, assignedBy: 'test' },
    })
    const roleB = await prisma.role.create({
      data: {
        tenantId: tenantB.id,
        name: 'ADMIN',
        isSystem: true,
        dataVisibility: 'ALL',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    await prisma.userRole.create({
      data: { userId: 'user-b', roleId: roleB.id, assignedBy: 'test' },
    })

    const stageA = await createDealStage(tenantA.id, 'First', 1)
    const contactA = await createContact(tenantA.id, 'a@example.com', 'user-a')

    const deal = await prisma.deal.create({
      data: {
        tenantId: tenantA.id,
        title: 'Secret Deal',
        stageId: stageA.id,
        contactId: contactA.id,
        ownerId: 'user-a',
        createdBy: 'user-a',
        updatedBy: 'user-a',
      },
    })

    const tokenB = tokenFor(tenantB.id, 'user-b')

    const response = await graphqlRequest(
      tokenB,
      `query Deal($id: ID!) { deal(id: $id) { id title } }`,
      { id: deal.id },
    )

    expect(response.status).toBe(200)
    expect(response.body.errors?.[0]?.message).toContain('Deal not found')
    expect(response.body.data.deal).toBeNull()
  })

  describe('DealStage CRUD', () => {
    it('creates and retrieves deal stages through GraphQL', async () => {
      const tenant = await createTenant('Stage Tenant')
      const userId = 'stage-user'
      await createTestUser(tenant.id, userId)
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
      await prisma.userRole.create({ data: { userId, roleId: role.id, assignedBy: 'test' } })

      const token = tokenFor(tenant.id, userId)

      // Create stage
      const createRes = await graphqlRequest(
        token,
        `mutation CreateStage($name: String!, $color: String, $probability: Int) {
          createDealStage(name: $name, color: $color, probability: $probability) {
            id name color probability isWon isLost
          }
        }`,
        { name: 'Hot Lead', color: '#FF0000', probability: 75 },
      )

      expect(createRes.status).toBe(200)
      expect(createRes.body.errors).toBeUndefined()
      expect(createRes.body.data.createDealStage.name).toBe('Hot Lead')
      expect(createRes.body.data.createDealStage.isWon).toBe(false)
      expect(createRes.body.data.createDealStage.isLost).toBe(false)

      // Query stages
      const listRes = await graphqlRequest(
        token,
        `query { dealStages { id name color probability } }`,
        {},
      )
      expect(listRes.status).toBe(200)
      expect(listRes.body.data.dealStages).toHaveLength(1)
      expect(listRes.body.data.dealStages[0].name).toBe('Hot Lead')

      // Update stage
      const stageId = createRes.body.data.createDealStage.id
      const updateRes = await graphqlRequest(
        token,
        `mutation UpdateStage($id: ID!, $name: String, $isWon: Boolean, $isLost: Boolean) {
          updateDealStage(id: $id, name: $name, isWon: $isWon, isLost: $isLost) {
            id name isWon isLost
          }
        }`,
        { id: stageId, name: 'Hotter Lead', isWon: true },
      )

      expect(updateRes.status).toBe(200)
      expect(updateRes.body.errors).toBeUndefined()
      expect(updateRes.body.data.updateDealStage.name).toBe('Hotter Lead')
      expect(updateRes.body.data.updateDealStage.isWon).toBe(true)

      // Reorder (only one stage — just verify it doesn't error)
      const reorderRes = await graphqlRequest(
        token,
        `mutation ReorderStages($stageIds: [ID!]!) {
          reorderDealStages(stageIds: $stageIds) { id name order }
        }`,
        { stageIds: [stageId] },
      )
      expect(reorderRes.status).toBe(200)
      expect(reorderRes.body.errors).toBeUndefined()
    })

    it('rejects duplicate stage name within tenant', async () => {
      const tenant = await createTenant('Dedup Tenant')
      const userId = 'dedup-user'
      await createTestUser(tenant.id, userId)
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
      await prisma.userRole.create({ data: { userId, roleId: role.id, assignedBy: 'test' } })

      const token = tokenFor(tenant.id, userId)

      await graphqlRequest(
        token,
        `mutation CreateStage($name: String!) { createDealStage(name: $name) { id } }`,
        { name: 'Duplicate' },
      )

      const dupRes = await graphqlRequest(
        token,
        `mutation CreateStage($name: String!) { createDealStage(name: $name) { id } }`,
        { name: 'Duplicate' },
      )

      expect(dupRes.status).toBe(200)
      expect(dupRes.body.errors).toBeDefined()
      expect(dupRes.body.errors[0].message).toContain('already exists')
    })
  })
})
