import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'
import { resolveVisibilityFilter } from '../common/guards/visibility-check'
import type { Deal, Prisma } from '@prisma/client'

export type CreateDealInput = {
  title: string
  value?: number
  currency?: string
  probability?: number
  stageId: string
  contactId: string
  ownerId?: string
  expectedCloseDate?: string
}

export type UpdateDealInput = {
  title?: string
  value?: number | null
  currency?: string
  probability?: number | null
  stageId?: string
  contactId?: string
  expectedCloseDate?: string | null
  actualCloseDate?: string | null
}

export type DealFilterInput = {
  search?: string
  stageId?: string
  contactId?: string
  ownerId?: string
  expectedCloseDateFrom?: string
  expectedCloseDateTo?: string
}

export type DealPaginationInput = {
  page?: number
  pageSize?: number
}

export type DealConnection = {
  items: Deal[]
  total: number
  page: number
  pageSize: number
}

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100
const MAX_TITLE_LENGTH = 200

const dealListSelect = {
  id: true,
  tenantId: true,
  title: true,
  value: true,
  currency: true,
  probability: true,
  stageId: true,
  contactId: true,
  ownerId: true,
  expectedCloseDate: true,
  actualCloseDate: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  stage: {
    select: { id: true, name: true, color: true, probability: true, isWon: true, isLost: true },
  },
  contact: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
  owner: {
    select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
  },
} as const

export type DealListItem = Prisma.DealGetPayload<{ select: typeof dealListSelect }>

function normalizeRequiredString(value: string, fieldName: string): string {
  const normalizedValue = value.trim()
  if (!normalizedValue) {
    throw new BadRequestException(`${fieldName} is required`)
  }
  if (normalizedValue.length > MAX_TITLE_LENGTH) {
    throw new BadRequestException(`${fieldName} must be at most ${MAX_TITLE_LENGTH} characters`)
  }
  return normalizedValue
}

function normalizeCreateInput(input: CreateDealInput): CreateDealInput {
  return {
    title: normalizeRequiredString(input.title, 'Title'),
    value: input.value ?? 0,
    currency: input.currency?.trim().toUpperCase() || 'USD',
    probability: input.probability,
    stageId: input.stageId,
    contactId: input.contactId,
    ownerId: input.ownerId,
    expectedCloseDate: input.expectedCloseDate,
  }
}

function normalizeUpdateInput(input: UpdateDealInput): UpdateDealInput {
  const normalized: UpdateDealInput = {}
  if (input.title !== undefined) {
    normalized.title = normalizeRequiredString(input.title, 'Title')
  }
  if (input.value !== undefined) {
    if (input.value === null) {
      throw new BadRequestException('Value cannot be cleared (non-nullable)')
    }
    if (input.value < 0) {
      throw new BadRequestException('Value must be 0 or greater')
    }
    normalized.value = input.value
  }
  if (input.currency !== undefined) {
    normalized.currency = input.currency.trim().toUpperCase()
  }
  if (input.probability !== undefined) {
    normalized.probability = input.probability
  }
  if (input.stageId !== undefined) {
    normalized.stageId = input.stageId
  }
  if (input.contactId !== undefined) {
    normalized.contactId = input.contactId
  }
  if (input.expectedCloseDate !== undefined) {
    normalized.expectedCloseDate = input.expectedCloseDate
  }
  if (input.actualCloseDate !== undefined) {
    normalized.actualCloseDate = input.actualCloseDate
  }
  return normalized
}

@Injectable()
export class DealsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, userId: string, input: CreateDealInput): Promise<Deal> {
    const normalizedInput = normalizeCreateInput(input)

    // Validate value is non-negative
    const dealValue = normalizedInput.value ?? 0
    if (dealValue < 0) {
      throw new BadRequestException('Value must be 0 or greater')
    }

    // Validate contactId exists in tenant
    const contact = await this.prisma.contact.findFirst({
      where: { id: normalizedInput.contactId, tenantId, deletedAt: null },
    })
    if (!contact) {
      throw new NotFoundException('Contact not found')
    }

    // Validate stageId exists in tenant
    const stage = await this.prisma.dealStage.findFirst({
      where: { id: normalizedInput.stageId, tenantId, deletedAt: null },
    })
    if (!stage) {
      throw new NotFoundException('Stage not found')
    }

    const deal = await this.prisma.deal.create({
      data: {
        tenantId,
        title: normalizedInput.title,
        value: normalizedInput.value,
        currency: normalizedInput.currency,
        probability: normalizedInput.probability ?? stage.probability,
        stageId: normalizedInput.stageId,
        contactId: normalizedInput.contactId,
        ownerId: normalizedInput.ownerId ?? userId,
        expectedCloseDate: normalizedInput.expectedCloseDate
          ? new Date(normalizedInput.expectedCloseDate)
          : null,
        createdBy: userId,
        updatedBy: userId,
      },
    })

    return deal
  }

  async findOne(tenantId: string, userId: string, id: string): Promise<Deal> {
    const deal = await this.prisma.deal.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        stage: {
          select: {
            id: true,
            name: true,
            color: true,
            probability: true,
            isWon: true,
            isLost: true,
          },
        },
        contact: { select: { id: true, firstName: true, lastName: true, email: true } },
        owner: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true } },
      },
    })

    if (!deal) {
      throw new NotFoundException('Deal not found')
    }

    // Apply data visibility filter
    const visibilityFilter = await resolveVisibilityFilter(userId, tenantId)

    let hasAccess = true
    if (visibilityFilter !== undefined) {
      if (typeof visibilityFilter === 'string') {
        hasAccess = deal.ownerId === visibilityFilter
      } else {
        const allowedIds = (visibilityFilter as { in: string[] }).in
        hasAccess = allowedIds.includes(deal.ownerId)
      }
    }

    if (!hasAccess) {
      throw new NotFoundException('Deal not found')
    }

    return deal
  }

  async findMany(
    tenantId: string,
    userId: string,
    filter: DealFilterInput = {},
    pagination: DealPaginationInput = {},
  ): Promise<DealConnection> {
    const page = Math.max(pagination.page ?? DEFAULT_PAGE, 1)
    const pageSize = Math.min(Math.max(pagination.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)
    const search = filter.search?.trim()

    const visibilityFilter = await resolveVisibilityFilter(userId, tenantId)

    const where: Prisma.DealWhereInput = {
      tenantId,
      deletedAt: null,
    }

    const andConditions: Prisma.DealWhereInput[] = []

    // Apply visibility filter
    if (visibilityFilter !== undefined) {
      andConditions.push({ ownerId: visibilityFilter as Prisma.DealWhereInput['ownerId'] })
    }

    if (search) {
      andConditions.push({
        title: { contains: search, mode: 'insensitive' },
      })
    }

    if (filter.stageId) {
      andConditions.push({ stageId: filter.stageId })
    }

    if (filter.contactId) {
      andConditions.push({ contactId: filter.contactId })
    }

    if (filter.ownerId) {
      andConditions.push({ ownerId: filter.ownerId })
    }

    if (filter.expectedCloseDateFrom || filter.expectedCloseDateTo) {
      const dateFilter: Prisma.DateTimeFilter = {}
      if (filter.expectedCloseDateFrom) {
        dateFilter.gte = new Date(filter.expectedCloseDateFrom)
      }
      if (filter.expectedCloseDateTo) {
        const endDate = new Date(filter.expectedCloseDateTo)
        endDate.setHours(23, 59, 59, 999)
        dateFilter.lte = endDate
      }
      andConditions.push({ expectedCloseDate: dateFilter })
    }

    if (andConditions.length > 0) {
      where.AND = andConditions
    }

    const [items, total] = await Promise.all([
      this.prisma.deal.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: dealListSelect,
      }),
      this.prisma.deal.count({ where }),
    ])

    return {
      items: items as unknown as Deal[],
      total,
      page,
      pageSize,
    }
  }

  async update(
    tenantId: string,
    userId: string,
    id: string,
    input: UpdateDealInput,
  ): Promise<Deal> {
    // Verify deal exists and is visible
    await this.findOne(tenantId, userId, id)

    const normalizedInput = normalizeUpdateInput(input)

    // If contactId is changing, validate new contact
    if (normalizedInput.contactId !== undefined) {
      const contact = await this.prisma.contact.findFirst({
        where: { id: normalizedInput.contactId, tenantId, deletedAt: null },
      })
      if (!contact) {
        throw new NotFoundException('Contact not found')
      }
    }

    // If stageId is changing, validate new stage
    if (normalizedInput.stageId !== undefined) {
      const stage = await this.prisma.dealStage.findFirst({
        where: { id: normalizedInput.stageId, tenantId, deletedAt: null },
      })
      if (!stage) {
        throw new NotFoundException('Stage not found')
      }
    }

    const updateData: Record<string, unknown> = {
      updatedBy: userId,
    }

    if (normalizedInput.title !== undefined) updateData.title = normalizedInput.title
    if (normalizedInput.value !== undefined) {
      if (normalizedInput.value === null) {
        throw new BadRequestException('Value cannot be cleared (non-nullable)')
      }
      updateData.value = normalizedInput.value
    }
    if (normalizedInput.currency !== undefined) updateData.currency = normalizedInput.currency
    if (normalizedInput.probability !== undefined)
      updateData.probability = normalizedInput.probability
    if (normalizedInput.stageId !== undefined) updateData.stageId = normalizedInput.stageId
    if (normalizedInput.contactId !== undefined) updateData.contactId = normalizedInput.contactId
    if (normalizedInput.expectedCloseDate !== undefined) {
      updateData.expectedCloseDate =
        normalizedInput.expectedCloseDate === null
          ? null
          : new Date(normalizedInput.expectedCloseDate)
    }
    if (normalizedInput.actualCloseDate !== undefined) {
      updateData.actualCloseDate =
        normalizedInput.actualCloseDate === null ? null : new Date(normalizedInput.actualCloseDate)
    }

    const result = await this.prisma.deal.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: updateData,
    })

    if (result.count === 0) {
      throw new NotFoundException('Deal not found')
    }

    return this.findOne(tenantId, userId, id)
  }

  async moveToStage(
    tenantId: string,
    userId: string,
    dealId: string,
    newStageId: string,
  ): Promise<Deal> {
    // Validate deal exists and is visible
    await this.findOne(tenantId, userId, dealId)

    // Validate target stage exists in tenant (do NOT auto-sync probability — Story 3.3 scope)
    const stage = await this.prisma.dealStage.findFirst({
      where: { id: newStageId, tenantId, deletedAt: null },
    })
    if (!stage) {
      throw new NotFoundException('Stage not found')
    }

    const result = await this.prisma.deal.updateMany({
      where: { id: dealId, tenantId, deletedAt: null },
      data: {
        stageId: newStageId,
        updatedBy: userId,
        // Do NOT auto-sync probability — that belongs to Story 3.3
      },
    })

    if (result.count === 0) {
      throw new NotFoundException('Deal not found')
    }

    return this.findOne(tenantId, userId, dealId)
  }

  async delete(tenantId: string, userId: string, id: string): Promise<boolean> {
    // Verify deal exists and is visible
    await this.findOne(tenantId, userId, id)

    const result = await this.prisma.deal.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: { deletedAt: new Date(), updatedBy: userId },
    })

    if (result.count === 0) {
      throw new NotFoundException('Deal not found')
    }

    return true
  }
}
