import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'
import { DealsService } from '../deals/deals.service'
import { assertLineItemNumbers, computeLineItemTotal, sumLineItemTotals } from './line-item-math'

export type AddLineItemInput = {
  dealId: string
  productId: string
  quantity?: number
  unitPrice?: number
  discount?: number
}

export type UpdateLineItemInput = {
  quantity?: number
  unitPrice?: number
  discount?: number
}

const LINE_ITEM_INCLUDE: Record<string, unknown> = {
  product: {
    select: {
      id: true,
      name: true,
      description: true,
      price: true,
      currency: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  },
}

@Injectable()
export class DealLineItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deals: DealsService,
  ) {}

  async findManyForDeal(
    tenantId: string,
    userId: string,
    dealId: string,
  ): Promise<Record<string, unknown>[]> {
    // Resolve deal through DealsService.findOne — enforces tenant + visibility
    await this.deals.findOne(tenantId, userId, dealId)

    return this.prisma.dealLineItem.findMany({
      where: { tenantId, dealId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      include: LINE_ITEM_INCLUDE,
    })
  }

  async add(
    tenantId: string,
    userId: string,
    input: AddLineItemInput,
  ): Promise<Record<string, unknown>> {
    // Verify deal visibility
    await this.deals.findOne(tenantId, userId, input.dealId)

    // Verify product exists and is active
    const product = await this.prisma.product.findFirst({
      where: { id: input.productId, tenantId, deletedAt: null },
    })
    if (!product) {
      throw new NotFoundException('Product not found')
    }
    if (!product.isActive) {
      throw new BadRequestException('Product is inactive')
    }

    // Default unitPrice from product price
    const unitPrice = input.unitPrice ?? product.price
    const quantity = input.quantity ?? 1
    const discount = input.discount ?? 0

    assertLineItemNumbers({ quantity, unitPrice, discount })
    const total = computeLineItemTotal({ quantity, unitPrice, discount })

    // Interactive transaction: write line item + recompute deal value + pubsub
    const lineItem = await this.prisma.$transaction(async (tx) => {
      const created = await tx.dealLineItem.create({
        data: {
          tenantId,
          dealId: input.dealId,
          productId: input.productId,
          quantity,
          unitPrice,
          discount,
          total,
          createdBy: userId,
          updatedBy: userId,
        },
        include: LINE_ITEM_INCLUDE,
      })

      // Recompute deal value
      const items = await tx.dealLineItem.findMany({
        where: { tenantId, dealId: input.dealId, deletedAt: null },
        select: { total: true },
      })
      const newValue = sumLineItemTotals(items)
      await tx.deal.update({
        where: { id: input.dealId },
        data: { value: newValue, updatedBy: userId },
      })

      return created
    })

    // Publish deal update after commit
    const deal = await this.deals.findOne(tenantId, userId, input.dealId)
    this.deals.publishDealUpdate(tenantId, deal)

    return lineItem
  }

  async update(
    tenantId: string,
    userId: string,
    id: string,
    input: UpdateLineItemInput,
  ): Promise<Record<string, unknown>> {
    // Load the line item
    const lineItem = await this.prisma.dealLineItem.findFirst({
      where: { id, tenantId, deletedAt: null },
    })
    if (!lineItem) {
      throw new NotFoundException('Deal line item not found')
    }

    // Re-verify deal visibility
    await this.deals.findOne(tenantId, userId, lineItem.dealId)

    // Merge provided fields
    const quantity = input.quantity ?? lineItem.quantity
    const unitPrice = input.unitPrice ?? lineItem.unitPrice
    const discount = input.discount ?? lineItem.discount

    assertLineItemNumbers({ quantity, unitPrice, discount })
    const total = computeLineItemTotal({ quantity, unitPrice, discount })

    // Interactive transaction
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.dealLineItem.update({
        where: { id },
        data: {
          quantity,
          unitPrice,
          discount,
          total,
          updatedBy: userId,
        },
        include: LINE_ITEM_INCLUDE,
      })

      // Recompute deal value
      const items = await tx.dealLineItem.findMany({
        where: { tenantId, dealId: lineItem.dealId, deletedAt: null },
        select: { total: true },
      })
      const newValue = sumLineItemTotals(items)
      await tx.deal.update({
        where: { id: lineItem.dealId },
        data: { value: newValue, updatedBy: userId },
      })

      return result
    })

    // Publish deal update
    const deal = await this.deals.findOne(tenantId, userId, lineItem.dealId)
    this.deals.publishDealUpdate(tenantId, deal)

    return updated
  }

  async remove(tenantId: string, userId: string, id: string): Promise<boolean> {
    const lineItem = await this.prisma.dealLineItem.findFirst({
      where: { id, tenantId, deletedAt: null },
    })
    if (!lineItem) {
      throw new NotFoundException('Deal line item not found')
    }

    // Re-verify deal visibility
    await this.deals.findOne(tenantId, userId, lineItem.dealId)

    // Soft-delete inside transaction
    await this.prisma.$transaction(async (tx) => {
      await tx.dealLineItem.update({
        where: { id },
        data: { deletedAt: new Date(), updatedBy: userId },
      })

      // Recompute deal value (0 when nothing left)
      const items = await tx.dealLineItem.findMany({
        where: { tenantId, dealId: lineItem.dealId, deletedAt: null },
        select: { total: true },
      })
      const newValue = sumLineItemTotals(items)
      await tx.deal.update({
        where: { id: lineItem.dealId },
        data: { value: newValue, updatedBy: userId },
      })
    })

    // Publish deal update
    const deal = await this.deals.findOne(tenantId, userId, lineItem.dealId)
    this.deals.publishDealUpdate(tenantId, deal)

    return true
  }
}
