/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-explicit-any */
import { BadRequestException, NotFoundException } from '@nestjs/common'

import { DealLineItemsService } from '../deal-line-items.service'

function makePrisma() {
  return {
    dealLineItem: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    deal: {
      update: jest.fn(),
    },
    product: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn((cb) =>
      cb({
        dealLineItem: {
          create: jest.fn().mockReturnValue({
            id: 'li-1',
            product: { id: 'product-1', name: 'Consulting', currency: 'USD', isActive: true },
          }),
          findMany: jest.fn().mockResolvedValue([{ total: 5000 }]),
          update: jest.fn(),
        },
        deal: {
          update: jest.fn(),
        },
      }),
    ),
  }
}

function makeDealsService() {
  return {
    findOne: jest.fn().mockResolvedValue({
      id: 'deal-1',
      tenantId: 'tenant-1',
      title: 'Big Deal',
      value: 50000,
      currency: 'USD',
      probability: 10,
    }),
    publishDealUpdate: jest.fn(),
  }
}

const TENANT_ID = 'tenant-1'
const USER_ID = 'user-1'
const DEAL_ID = 'deal-1'
const PRODUCT_ID = 'product-1'

function makeProduct(overrides = {}) {
  return {
    id: PRODUCT_ID,
    tenantId: TENANT_ID,
    name: 'Consulting',
    price: 5000,
    currency: 'USD',
    isActive: true,
    deletedAt: null,
    ...overrides,
  }
}

function makeLineItem(overrides = {}) {
  return {
    id: 'li-1',
    tenantId: TENANT_ID,
    dealId: DEAL_ID,
    productId: PRODUCT_ID,
    quantity: 1,
    unitPrice: 5000,
    discount: 0,
    total: 5000,
    deletedAt: null,
    ...overrides,
  }
}

describe('DealLineItemsService', () => {
  let service: DealLineItemsService
  let prisma: ReturnType<typeof makePrisma>
  let deals: ReturnType<typeof makeDealsService>

  beforeEach(() => {
    prisma = makePrisma()
    deals = makeDealsService()
    service = new DealLineItemsService(prisma as any, deals as any)
  })

  describe('findManyForDeal', () => {
    it('verifies deal via DealsService.findOne first', async () => {
      prisma.dealLineItem.findMany.mockResolvedValue([])
      await service.findManyForDeal(TENANT_ID, USER_ID, DEAL_ID)
      expect(deals.findOne).toHaveBeenCalledWith(TENANT_ID, USER_ID, DEAL_ID)
    })

    it('throws NotFoundException for cross-tenant deal', async () => {
      deals.findOne.mockRejectedValue(new NotFoundException('Deal not found'))
      await expect(service.findManyForDeal('tenant-2', USER_ID, DEAL_ID)).rejects.toThrow(
        NotFoundException,
      )
    })

    it('returns line items with product include', async () => {
      const mockItems = [makeLineItem()]
      prisma.dealLineItem.findMany.mockResolvedValue(mockItems)
      await service.findManyForDeal(TENANT_ID, USER_ID, DEAL_ID)
      expect(prisma.dealLineItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deletedAt: null }),
          include: expect.objectContaining({ product: expect.anything() }),
        }),
      )
    })
  })

  describe('add', () => {
    const defaultInput = { dealId: DEAL_ID, productId: PRODUCT_ID }

    it('throws NotFoundException for cross-tenant product', async () => {
      prisma.product.findFirst.mockResolvedValue(null)
      await expect(service.add(TENANT_ID, USER_ID, defaultInput)).rejects.toThrow(NotFoundException)
    })

    it('throws BadRequestException for inactive product', async () => {
      prisma.product.findFirst.mockResolvedValue(makeProduct({ isActive: false }))
      await expect(service.add(TENANT_ID, USER_ID, defaultInput)).rejects.toThrow(
        BadRequestException,
      )
    })

    it('defaults unitPrice to product.price when omitted', async () => {
      prisma.product.findFirst.mockResolvedValue(makeProduct())
      await service.add(TENANT_ID, USER_ID, defaultInput)
      expect(prisma.$transaction).toHaveBeenCalled()
    })

    it('uses provided unitPrice over product.price', async () => {
      prisma.product.findFirst.mockResolvedValue(makeProduct({ price: 5000 }))
      await service.add(TENANT_ID, USER_ID, { ...defaultInput, unitPrice: 7500 })
      expect(prisma.$transaction).toHaveBeenCalled()
    })

    it('computes total server-side', async () => {
      prisma.product.findFirst.mockResolvedValue(makeProduct({ price: 5000 }))
      await service.add(TENANT_ID, USER_ID, { ...defaultInput, quantity: 3, discount: 10 })
      expect(prisma.$transaction).toHaveBeenCalled()
    })

    it('calls publishDealUpdate after commit', async () => {
      prisma.product.findFirst.mockResolvedValue(makeProduct())
      await service.add(TENANT_ID, USER_ID, defaultInput)
      expect(deals.publishDealUpdate).toHaveBeenCalled()
    })
  })

  describe('update', () => {
    it('re-verifies deal through findOne (visibility gate)', async () => {
      prisma.dealLineItem.findFirst.mockResolvedValue(makeLineItem())
      prisma.dealLineItem.findMany.mockResolvedValue([makeLineItem()])
      await service.update(TENANT_ID, USER_ID, 'li-1', { quantity: 2 })
      expect(deals.findOne).toHaveBeenCalled()
    })

    it('throws NotFoundException for cross-tenant line item', async () => {
      prisma.dealLineItem.findFirst.mockResolvedValue(null)
      await expect(service.update('tenant-2', USER_ID, 'li-1', { quantity: 2 })).rejects.toThrow(
        NotFoundException,
      )
    })

    it('recomputes deal value inside $transaction', async () => {
      prisma.dealLineItem.findFirst.mockResolvedValue(makeLineItem())
      await service.update(TENANT_ID, USER_ID, 'li-1', { quantity: 2 })
      expect(prisma.$transaction).toHaveBeenCalled()
    })
  })

  describe('remove', () => {
    it('soft-deletes the line item and recomputes deal value', async () => {
      prisma.dealLineItem.findFirst.mockResolvedValue(makeLineItem())
      prisma.dealLineItem.findMany.mockResolvedValue([])
      await service.remove(TENANT_ID, USER_ID, 'li-1')
      expect(prisma.$transaction).toHaveBeenCalled()
    })

    it('calls publishDealUpdate after commit', async () => {
      prisma.dealLineItem.findFirst.mockResolvedValue(makeLineItem())
      prisma.dealLineItem.findMany.mockResolvedValue([])
      await service.remove(TENANT_ID, USER_ID, 'li-1')
      expect(deals.publishDealUpdate).toHaveBeenCalled()
    })

    it('throws NotFoundException for already-removed line item', async () => {
      prisma.dealLineItem.findFirst.mockResolvedValue(null)
      await expect(service.remove(TENANT_ID, USER_ID, 'li-1')).rejects.toThrow(NotFoundException)
    })
  })
})
