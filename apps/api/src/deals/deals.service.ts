import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { ActivityService } from '../activities/activities.service'
import { ActivityLogPreferenceService } from '../activities/activity-log-preference.service'
import { resolveVisibilityFilter } from '../common/guards/visibility-check'
import { DealPubSubService, PUBSUB_DEAL_UPDATED } from './deal-pubsub.service'
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
  winLossReason: true,
  winLossNote: true,
  competitorId: true,
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
  competitor: {
    select: { id: true, name: true },
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

function normalizeProbability(value: number): number {
  if (!Number.isInteger(value)) {
    throw new BadRequestException('Probability must be between 0 and 100')
  }
  if (value < 0 || value > 100) {
    throw new BadRequestException('Probability must be between 0 and 100')
  }
  return value
}

function normalizeCreateInput(input: CreateDealInput): CreateDealInput {
  return {
    title: normalizeRequiredString(input.title, 'Title'),
    value: input.value ?? 0,
    currency: input.currency?.trim().toUpperCase() || 'USD',
    probability:
      input.probability !== undefined ? normalizeProbability(input.probability) : input.probability,
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
    if (input.probability === null) {
      throw new BadRequestException(
        'Probability cannot be cleared (always set from stage or explicit value)',
      )
    }
    normalized.probability = normalizeProbability(input.probability)
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly dealPubSub: DealPubSubService,
    private readonly audit: AuditService,
    private readonly activity: ActivityService,
    private readonly activityLogPreference: ActivityLogPreferenceService,
  ) {}

  /**
   * Service-level audit write. The global AuditInterceptor (registered via
   * APP_INTERCEPTOR) does NOT wrap GraphQL resolvers in this repo — the
   * hand-built Pothos schema (builder.toSchema() → GraphQLModule.forRoot)
   * bypasses the NestJS resolver map, so intercept() never fires for
   * mutations. Deal CUD produced zero AuditLog rows despite NFR9 requiring
   * them; writing here, synchronously inside the mutation, is the only path
   * that actually works. Mirrors TasksService.writeAudit.
   */
  private writeAudit(
    tenantId: string,
    userId: string,
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    entityId: string,
  ): Promise<void> {
    return this.audit.log({
      tenantId,
      userId,
      action,
      entity: 'DEAL',
      entityId,
      details: { mutationName: action },
    })
  }

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

    const createdDeal = await this.findOne(tenantId, userId, deal.id)
    this.dealPubSub.publish(`${PUBSUB_DEAL_UPDATED}:${tenantId}`, createdDeal)

    await this.writeAudit(tenantId, userId, 'CREATE', createdDeal.id)

    // Story 4.2: auto-log the creation on the deal's contact (AC 24).
    // contactId is guaranteed non-null — validated at deals.service.ts create.
    await this.logDealCreated(tenantId, userId, createdDeal)

    return createdDeal
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
        competitor: { select: { id: true, name: true } },
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

    const where = await this.buildDealWhere(tenantId, userId, filter)

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

  async buildDealWhere(
    tenantId: string,
    userId: string,
    filter: DealFilterInput = {},
  ): Promise<Prisma.DealWhereInput> {
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

    return where
  }

  async pipelineSummary(
    tenantId: string,
    userId: string,
    filter: DealFilterInput = {},
  ): Promise<Array<{ stageId: string; count: number; totalValue: number }>> {
    const where = await this.buildDealWhere(tenantId, userId, filter)

    const [grouped, allStages] = await Promise.all([
      this.prisma.deal.groupBy({
        by: ['stageId'],
        where,
        _count: { _all: true },
        _sum: { value: true },
      }),
      this.prisma.dealStage.findMany({
        where: { tenantId, deletedAt: null },
        select: { id: true },
      }),
    ])

    const summaryMap = new Map<string, { count: number; totalValue: number }>()
    for (const entry of grouped) {
      summaryMap.set(entry.stageId, {
        count: entry._count?._all ?? 0,
        totalValue: entry._sum?.value ?? 0,
      })
    }

    // Ensure all stages appear in output, even those with zero deals
    return allStages.map((stage) => ({
      stageId: stage.id,
      count: summaryMap.get(stage.id)?.count ?? 0,
      totalValue: summaryMap.get(stage.id)?.totalValue ?? 0,
    }))
  }

  async update(
    tenantId: string,
    userId: string,
    id: string,
    input: UpdateDealInput,
  ): Promise<Deal> {
    // Verify deal exists and is visible
    const currentDeal = await this.findOne(tenantId, userId, id)

    // Value lock: reject manual value change when line items exist
    if (input.value !== undefined && input.value !== null) {
      const activeLineItems = await this.prisma.dealLineItem.count({
        where: { dealId: id, tenantId, deletedAt: null },
      })
      if (activeLineItems > 0) {
        if (Math.abs(input.value - currentDeal.value) > 0.005) {
          throw new BadRequestException(
            'Deal value is derived from line items \u2014 remove the line items to set it manually',
          )
        }
        // No-op within tolerance: drop value from payload
        delete input.value
      }
    }

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

    const updatedDeal = await this.findOne(tenantId, userId, id)
    this.dealPubSub.publish(`${PUBSUB_DEAL_UPDATED}:${tenantId}`, updatedDeal)

    await this.writeAudit(tenantId, userId, 'UPDATE', updatedDeal.id)

    return updatedDeal
  }

  async moveToStage(
    tenantId: string,
    userId: string,
    dealId: string,
    newStageId: string,
  ): Promise<Deal> {
    // Validate deal exists and is visible — keep the pre-move snapshot for
    // the DEAL_STAGE_CHANGED log (from-stage name/id).
    const currentDeal = await this.findOne(tenantId, userId, dealId)

    // Validate target stage exists in tenant
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
        probability: stage.probability,
        actualCloseDate: stage.isWon || stage.isLost ? new Date() : null,
        updatedBy: userId,
      },
    })

    if (result.count === 0) {
      throw new NotFoundException('Deal not found')
    }

    const movedDeal = await this.findOne(tenantId, userId, dealId)
    this.dealPubSub.publish(`${PUBSUB_DEAL_UPDATED}:${tenantId}`, movedDeal)

    await this.writeAudit(tenantId, userId, 'UPDATE', movedDeal.id)

    // Story 4.2: auto-log the stage transition (AC 25). The from-stage name
    // comes from the pre-move snapshot captured above. `update()` and
    // `delete()` log nothing (AC 26) — field-level deal edits are
    // deliberately out of scope.
    const fromStageName =
      (currentDeal as Deal & { stage?: { name?: string } }).stage?.name ?? 'Unknown stage'
    await this.logDealStageChanged(
      tenantId,
      userId,
      movedDeal,
      fromStageName,
      stage.name,
      currentDeal.stageId,
    )

    return movedDeal
  }

  /**
   * Auto-log DEAL_CREATED on the deal's contact (AC 24). Suppressed when the
   * acting user's `logDealCreated` preference is off. Uses logSafe — a
   * logging failure never fails the deal mutation.
   */
  private async logDealCreated(tenantId: string, userId: string, deal: Deal): Promise<void> {
    if (!(await this.activityLogPreference.isEnabled(tenantId, userId, 'logDealCreated'))) {
      return
    }

    await this.activity.logSafe({
      tenantId,
      contactId: deal.contactId,
      type: 'DEAL_CREATED',
      title: `Deal created: ${deal.title}`,
      metadata: {
        dealId: deal.id,
        value: deal.value,
        currency: deal.currency,
        stageId: deal.stageId,
        ownerId: deal.ownerId,
      },
      source: 'DEAL',
      sourceId: deal.id,
      dedupeKey: `DEAL_CREATED:${deal.id}`,
      createdBy: userId,
    })
  }

  /**
   * Auto-log DEAL_STAGE_CHANGED (AC 25). Suppressed when the acting user's
   * `logDealStageChanged` preference is off. The dedupeKey carries the
   * occurredAt ISO timestamp (AC 15) so a later re-log of the same transition
   * is treated as a distinct event.
   */
  private async logDealStageChanged(
    tenantId: string,
    userId: string,
    deal: Deal,
    fromStageName: string,
    toStageName: string,
    fromStageId: string,
  ): Promise<void> {
    if (!(await this.activityLogPreference.isEnabled(tenantId, userId, 'logDealStageChanged'))) {
      return
    }

    await this.activity.logSafe({
      tenantId,
      contactId: deal.contactId,
      type: 'DEAL_STAGE_CHANGED',
      title: `Deal moved to ${toStageName}`,
      description: `${fromStageName} → ${toStageName}`,
      metadata: {
        dealId: deal.id,
        fromStageId,
        toStageId: deal.stageId,
      },
      source: 'DEAL',
      sourceId: deal.id,
      dedupeKey: `DEAL_STAGE:${deal.id}:${deal.stageId}:${new Date().toISOString()}`,
      createdBy: userId,
    })
  }

  async delete(tenantId: string, userId: string, id: string): Promise<boolean> {
    // Verify deal exists and is visible
    const deal = await this.findOne(tenantId, userId, id)

    const result = await this.prisma.deal.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: { deletedAt: new Date(), updatedBy: userId },
    })

    if (result.count === 0) {
      throw new NotFoundException('Deal not found')
    }

    // Publish the deal before delete so the board can remove it
    this.dealPubSub.publish(`${PUBSUB_DEAL_UPDATED}:${tenantId}`, deal)

    await this.writeAudit(tenantId, userId, 'DELETE', deal.id)

    return true
  }

  publishDealUpdate(tenantId: string, deal: Deal): void {
    this.dealPubSub.publish(`${PUBSUB_DEAL_UPDATED}:${tenantId}`, deal)
  }
}
