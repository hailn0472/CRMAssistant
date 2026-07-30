import { BadRequestException } from '@nestjs/common'

import { DealsService } from '../deals.service'
import type { Deal } from '@prisma/client'

jest.mock('../../common/guards/visibility-check', () => ({
  resolveVisibilityFilter: jest.fn(),
  registerVisibilityService: jest.fn(),
}))

import { resolveVisibilityFilter } from '../../common/guards/visibility-check'

type MockDealDelegate = {
  create: jest.Mock
  findFirst: jest.Mock
  findMany: jest.Mock
  count: jest.Mock
  updateMany: jest.Mock
  update: jest.Mock
  groupBy: jest.Mock
}

type MockPrisma = {
  deal: MockDealDelegate
  dealStage: { findFirst: jest.Mock; findMany: jest.Mock; count: jest.Mock }
  contact: { findFirst: jest.Mock }
  dealLineItem: { count: jest.Mock }
  $transaction: jest.Mock
}

function makePubSub(): { publish: jest.Mock; subscribe: jest.Mock } {
  return { publish: jest.fn(), subscribe: jest.fn() }
}

const TENANT_ID = 'tenant-1'
const USER_ID = 'user-1'
const DEAL_ID = 'deal-1'
const NOW = new Date('2026-07-29T00:00:00.000Z')

function makeDeal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: DEAL_ID,
    tenantId: TENANT_ID,
    title: 'Big Deal',
    value: 50000,
    currency: 'USD',
    probability: 10,
    stageId: 'stage-1',
    contactId: 'contact-1',
    ownerId: USER_ID,
    expectedCloseDate: null,
    actualCloseDate: null,
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: USER_ID,
    updatedBy: USER_ID,
    deletedAt: null,
    ...overrides,
  }
}

function makePrisma(): MockPrisma {
  return {
    deal: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
      groupBy: jest.fn(),
    },
    dealStage: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    contact: { findFirst: jest.fn() },
    dealLineItem: { count: jest.fn() },
    $transaction: jest.fn(),
  }
}

describe('DealsService — value lock (Story 3.4)', () => {
  let service: DealsService
  let prisma: MockPrisma
  let pubSub: ReturnType<typeof makePubSub>

  beforeEach(() => {
    prisma = makePrisma()
    pubSub = makePubSub()
    ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue(undefined)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new DealsService(prisma as any, pubSub as any)
  })

  it('rejects manual value change when deal has >= 1 active line item', async () => {
    prisma.deal.findFirst.mockResolvedValue(makeDeal())
    prisma.dealLineItem.count.mockResolvedValue(1)
    ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue(undefined)

    await expect(service.update(TENANT_ID, USER_ID, DEAL_ID, { value: 99999 })).rejects.toThrow(
      BadRequestException,
    )
  })

  it('allows identical value resubmission silently', async () => {
    prisma.deal.findFirst.mockResolvedValue(makeDeal({ value: 50000 }))
    prisma.dealLineItem.count.mockResolvedValue(1)
    prisma.deal.updateMany.mockResolvedValue({ count: 1 })
    prisma.deal.findFirst.mockResolvedValue(makeDeal({ value: 50000 }))

    const result = await service.update(TENANT_ID, USER_ID, DEAL_ID, { value: 50000 })
    expect(result).toBeDefined()
  })

  it('allows within-tolerance changes (<= 0.005 diff)', async () => {
    prisma.deal.findFirst.mockResolvedValue(makeDeal({ value: 50000 }))
    prisma.dealLineItem.count.mockResolvedValue(1)
    prisma.deal.updateMany.mockResolvedValue({ count: 1 })
    prisma.deal.findFirst.mockResolvedValue(makeDeal())

    const result = await service.update(TENANT_ID, USER_ID, DEAL_ID, { value: 50000.003 })
    expect(result).toBeDefined()
  })

  it('allows any value change when deal has zero line items', async () => {
    prisma.deal.findFirst.mockResolvedValue(makeDeal({ value: 50000 }))
    prisma.dealLineItem.count.mockResolvedValue(0)
    prisma.deal.updateMany.mockResolvedValue({ count: 1 })
    prisma.deal.findFirst.mockResolvedValue(makeDeal({ value: 75000 }))

    const result = await service.update(TENANT_ID, USER_ID, DEAL_ID, { value: 75000 })
    expect(result).toBeDefined()
  })

  it('does not interfere with non-value fields when line items exist', async () => {
    prisma.deal.findFirst.mockResolvedValue(makeDeal())
    prisma.dealLineItem.count.mockResolvedValue(1)
    prisma.deal.updateMany.mockResolvedValue({ count: 1 })
    prisma.deal.findFirst.mockResolvedValue(makeDeal({ title: 'New Title' }))

    const result = await service.update(TENANT_ID, USER_ID, DEAL_ID, { title: 'New Title' })
    expect(result).toBeDefined()
  })

  it('publishDealUpdate publishes to the deal-updated channel', () => {
    const deal = makeDeal()
    service.publishDealUpdate(TENANT_ID, deal)
    expect(pubSub.publish).toHaveBeenCalledWith(expect.stringContaining('DEAL_UPDATED'), deal)
  })
})
