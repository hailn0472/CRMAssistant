import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'

import { ProductsService } from '../products.service'

type MockProductDelegate = {
  findFirst: jest.Mock
  findMany: jest.Mock
  count: jest.Mock
  create: jest.Mock
  updateMany: jest.Mock
}

type MockPrisma = {
  product: MockProductDelegate
}

function makePrisma(): MockPrisma {
  return {
    product: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
  }
}

const TENANT_ID = 'tenant-1'
const OTHER_TENANT_ID = 'tenant-2'
const USER_ID = 'user-1'
const NOW = new Date()

function makeProduct(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'product-1',
    tenantId: TENANT_ID,
    name: 'Consulting Package',
    description: null,
    price: 5000,
    currency: 'USD',
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: USER_ID,
    updatedBy: USER_ID,
    deletedAt: null,
    ...overrides,
  }
}

describe('ProductsService', () => {
  let service: ProductsService
  let prisma: MockPrisma

  beforeEach(() => {
    prisma = makePrisma()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new ProductsService(prisma as any)
  })

  describe('create', () => {
    it('trims name and rejects empty name', async () => {
      await expect(service.create(TENANT_ID, USER_ID, { name: '   ' })).rejects.toThrow(
        BadRequestException,
      )
      await expect(service.create(TENANT_ID, USER_ID, { name: '   ' })).rejects.toThrow(
        'Product name is required',
      )
    })

    it('rejects name > 200 chars', async () => {
      await expect(service.create(TENANT_ID, USER_ID, { name: 'a'.repeat(201) })).rejects.toThrow(
        BadRequestException,
      )
    })

    it('uppercases currency', async () => {
      prisma.product.findFirst.mockResolvedValue(null)
      prisma.product.create.mockResolvedValue(makeProduct({ currency: 'USD' }))

      await service.create(TENANT_ID, USER_ID, { name: 'Test', currency: 'usd' })
      expect(prisma.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ currency: 'USD' }),
        }),
      )
    })

    it('rejects case-insensitive duplicate active name', async () => {
      prisma.product.findFirst.mockResolvedValue(makeProduct())
      await expect(
        service.create(TENANT_ID, USER_ID, { name: 'consulting package' }),
      ).rejects.toThrow(ConflictException)
    })

    it('allows reuse of name that was soft-deleted', async () => {
      prisma.product.findFirst.mockResolvedValue(null)
      prisma.product.create.mockResolvedValue(makeProduct())
      await expect(
        service.create(TENANT_ID, USER_ID, { name: 'Consulting Package' }),
      ).resolves.toBeDefined()
    })

    it('allows same name in different tenants', async () => {
      prisma.product.findFirst.mockResolvedValue(null)
      prisma.product.create.mockResolvedValue(makeProduct())
      await expect(
        service.create(OTHER_TENANT_ID, USER_ID, { name: 'Consulting Package' }),
      ).resolves.toBeDefined()
    })

    it('sets audit fields from userId', async () => {
      prisma.product.findFirst.mockResolvedValue(null)
      prisma.product.create.mockResolvedValue(makeProduct())
      await service.create(TENANT_ID, USER_ID, { name: 'Test' })
      expect(prisma.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ createdBy: USER_ID, updatedBy: USER_ID }),
        }),
      )
    })
  })

  describe('update', () => {
    it('allows toggle of isActive', async () => {
      prisma.product.findFirst.mockResolvedValue(makeProduct())
      prisma.product.updateMany.mockResolvedValue({ count: 1 })
      prisma.product.findFirst.mockResolvedValue(makeProduct({ isActive: false }))

      await service.update(TENANT_ID, USER_ID, 'product-1', { isActive: false })
      expect(prisma.product.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isActive: false }),
        }),
      )
    })

    it('rejects duplicate active name (excluding self)', async () => {
      prisma.product.findFirst
        .mockResolvedValueOnce(makeProduct()) // findOneForTenant success
        .mockResolvedValueOnce(makeProduct({ id: 'other-id' })) // duplicate check hits another
      await expect(
        service.update(TENANT_ID, USER_ID, 'product-1', { name: 'Existing Name' }),
      ).rejects.toThrow(ConflictException)
    })

    it('sets updatedBy', async () => {
      prisma.product.findFirst.mockResolvedValue(makeProduct())
      prisma.product.updateMany.mockResolvedValue({ count: 1 })
      prisma.product.findFirst.mockResolvedValue(makeProduct())
      await service.update(TENANT_ID, USER_ID, 'product-1', { description: 'New desc' })
      expect(prisma.product.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ updatedBy: USER_ID }),
        }),
      )
    })
  })

  describe('findMany', () => {
    it('excludes soft-deleted rows', async () => {
      prisma.product.findMany.mockResolvedValue([])
      prisma.product.count.mockResolvedValue(0)
      await service.findMany(TENANT_ID)
      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deletedAt: null }),
        }),
      )
    })

    it('excludes isActive: false by default', async () => {
      prisma.product.findMany.mockResolvedValue([])
      prisma.product.count.mockResolvedValue(0)
      await service.findMany(TENANT_ID)
      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true }),
        }),
      )
    })

    it('includes inactive when includeInactive: true', async () => {
      prisma.product.findMany.mockResolvedValue([])
      prisma.product.count.mockResolvedValue(0)
      await service.findMany(TENANT_ID, { includeInactive: true })
      const callWhere = (prisma.product.findMany as jest.Mock).mock.calls[0][0].where
      expect(callWhere.isActive).toBeUndefined()
    })

    it('applies default pageSize 20', async () => {
      prisma.product.findMany.mockResolvedValue([])
      prisma.product.count.mockResolvedValue(0)
      await service.findMany(TENANT_ID)
      expect(prisma.product.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 20 }))
    })

    it('caps pageSize at 100', async () => {
      prisma.product.findMany.mockResolvedValue([])
      prisma.product.count.mockResolvedValue(0)
      await service.findMany(TENANT_ID, {}, { pageSize: 200 })
      expect(prisma.product.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }))
    })

    it('tenant-scoped', async () => {
      prisma.product.findMany.mockResolvedValue([])
      prisma.product.count.mockResolvedValue(0)
      await service.findMany(TENANT_ID)
      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT_ID }),
        }),
      )
    })
  })

  describe('findOneForTenant', () => {
    it('returns product or throws NotFoundException', async () => {
      prisma.product.findFirst.mockResolvedValue(makeProduct())
      const result = await service.findOneForTenant(TENANT_ID, 'product-1')
      expect(result).toBeDefined()

      prisma.product.findFirst.mockResolvedValue(null)
      await expect(service.findOneForTenant(TENANT_ID, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  describe('no delete method', () => {
    it('has no delete or deleteProduct method', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((service as any).delete).toBeUndefined()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((service as any).deleteProduct).toBeUndefined()
    })
  })
})
