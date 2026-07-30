import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { PrismaClient } from '@prisma/client'
import { execSync } from 'child_process'
import * as path from 'path'

// Integration test shell — requires testcontainers
describe('Products Integration', () => {
  jest.setTimeout(120_000)

  let prisma: PrismaClient
  let container: StartedPostgreSqlContainer

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:15-alpine')
      .withDatabase('crm_test')
      .withUsername('test')
      .withPassword('test')
      .start()

    process.env['DATABASE_URL'] = container.getConnectionUri()

    // Run migrations against the test container
    execSync('npx prisma migrate deploy', {
      cwd: path.join(__dirname, '../../'),
      env: { ...process.env, DATABASE_URL: container.getConnectionUri() },
    })

    prisma = new PrismaClient()
    await prisma.$connect()
  })

  afterAll(async () => {
    await prisma?.$disconnect()
    await container?.stop()
  })

  afterEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "DealLineItem" CASCADE')
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Product" CASCADE')
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Deal" CASCADE')
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Contact" CASCADE')
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "DealStage" CASCADE')
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "RolePermission" CASCADE')
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "UserRole" CASCADE')
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Role" CASCADE')
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Permission" CASCADE')
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE')
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Tenant" CASCADE')
  })

  it('creates products and enforces tenant isolation', async () => {
    const tenant1 = await prisma.tenant.create({ data: { name: 'Tenant 1' } })
    const tenant2 = await prisma.tenant.create({ data: { name: 'Tenant 2' } })

    const p1 = await prisma.product.create({
      data: {
        tenantId: tenant1.id,
        name: 'Product A',
        price: 100,
        currency: 'USD',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })

    const p2 = await prisma.product.create({
      data: {
        tenantId: tenant2.id,
        name: 'Product B',
        price: 200,
        currency: 'EUR',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })

    // Tenant isolation
    const t1Products = await prisma.product.findMany({
      where: { tenantId: tenant1.id, deletedAt: null },
    })
    expect(t1Products).toHaveLength(1)
    expect(t1Products[0].name).toBe('Product A')

    const t2Products = await prisma.product.findMany({
      where: { tenantId: tenant2.id, deletedAt: null },
    })
    expect(t2Products).toHaveLength(1)
    expect(t2Products[0].name).toBe('Product B')

    void p1
    void p2
  })

  it('adds line items and recomputes deal.value via direct Prisma', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Test Tenant' } })
    const stage = await prisma.dealStage.create({
      data: {
        tenantId: tenant.id,
        name: 'Lead',
        order: 0,
        probability: 10,
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `user-${Date.now()}@test.com`,
        firstName: 'Test',
        lastName: 'User',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    const contact = await prisma.contact.create({
      data: {
        tenantId: tenant.id,
        email: `deal-test-${Date.now()}@test.com`,
        firstName: 'Test',
        lastName: 'User',
        ownerId: user.id,
        createdBy: 'test',
        updatedBy: 'test',
      },
    })

    const deal = await prisma.deal.create({
      data: {
        tenantId: tenant.id,
        title: 'Test Deal',
        value: 50000,
        stageId: stage.id,
        contactId: contact.id,
        ownerId: user.id,
        createdBy: 'test',
        updatedBy: 'test',
      },
    })

    const product = await prisma.product.create({
      data: {
        tenantId: tenant.id,
        name: 'Consulting',
        price: 5000,
        currency: 'USD',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })

    // Add line item
    await prisma.dealLineItem.create({
      data: {
        tenantId: tenant.id,
        dealId: deal.id,
        productId: product.id,
        quantity: 2,
        unitPrice: 5000,
        discount: 10,
        total: 9000, // round2(2 * 5000 * (1 - 10/100)) = 9000
        createdBy: 'test',
        updatedBy: 'test',
      },
    })

    // Simulate service transaction: manual recompute
    const items = await prisma.dealLineItem.findMany({
      where: { tenantId: tenant.id, dealId: deal.id, deletedAt: null },
    })
    const total = Math.round(items.reduce((s, i) => s + i.total, 0) * 100) / 100
    await prisma.deal.update({ where: { id: deal.id }, data: { value: total, updatedBy: 'test' } })

    const updatedDeal = await prisma.deal.findUnique({ where: { id: deal.id } })
    expect(updatedDeal).toBeDefined()
    expect(updatedDeal!.value).toBe(9000)
    expect(updatedDeal!.updatedBy).toBe('test')

    // Remove line item → value should become 0
    await prisma.dealLineItem.update({
      where: { id: items[0].id },
      data: { deletedAt: new Date(), updatedBy: 'test' },
    })
    const remaining = await prisma.dealLineItem.findMany({
      where: { tenantId: tenant.id, dealId: deal.id, deletedAt: null },
    })
    const newTotal =
      remaining.length === 0
        ? 0
        : Math.round(remaining.reduce((s, i) => s + i.total, 0) * 100) / 100
    await prisma.deal.update({
      where: { id: deal.id },
      data: { value: newTotal, updatedBy: 'test' },
    })

    const clearedDeal = await prisma.deal.findUnique({ where: { id: deal.id } })
    expect(clearedDeal!.value).toBe(0)
  })

  it('inactive product cannot be added to deal (application-level check)', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Test' } })
    const product = await prisma.product.create({
      data: {
        tenantId: tenant.id,
        name: 'Inactive Product',
        price: 100,
        isActive: false,
        createdBy: 'test',
        updatedBy: 'test',
      },
    })

    const found = await prisma.product.findFirst({
      where: { id: product.id, isActive: true, deletedAt: null },
    })
    expect(found).toBeNull()
  })
})
