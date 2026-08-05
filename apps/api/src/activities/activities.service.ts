import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'
import type { ActivityType, Prisma } from '@prisma/client'

import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { resolveVisibilityFilter } from '../common/guards/visibility-check'
import { resolveSharedRecordIds } from '../common/guards/sharing-check'
import { ActivityPubSubService, PUBSUB_ACTIVITY_LOGGED } from './activity-pubsub.service'
import { toUtcMidnight } from '../tasks/task-due-status'

export type CreateActivityInput = {
  tenantId: string
  contactId: string
  type: ActivityType
  title: string
  description?: string | null
  createdBy: string
  // Story 4.2 auto-logging fields. `source` is the producing domain
  // ('TASK' | 'DEAL' | 'MESSAGE'); null means manual entry (addContactNote).
  // `sourceId` is the originating row id; `dedupeKey` is the deterministic
  // per-event key (caller-produced, AC 15); `metadata` is persisted but never
  // exposed over GraphQL (AC 5).
  source?: string | null
  sourceId?: string | null
  dedupeKey?: string | null
  metadata?: Record<string, unknown> | null
}

export type ActivityTimelineEdge = {
  cursor: string
  node: {
    id: string
    type: string
    title: string
    description: string | null
    createdAt: string
    createdBy: string
    source: string | null
  }
}

export type ContactTimelineResult = {
  edges: ActivityTimelineEdge[]
  pageInfo: {
    hasNextPage: boolean
    endCursor: string | null
  }
  totalCount: number
}

export type TimelineQueryArgs = {
  first?: number
  after?: string
  includeTotalCount?: boolean
}

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 50

// Fields that should be excluded from auto-logging change detection
const EXCLUDED_FIELDS = new Set([
  'updatedAt',
  'updatedBy',
  'deletedAt',
  'ownerId',
  'id',
  'createdAt',
])

// The select must cover EVERY field the Pothos Activity ref exposes — `source`
// is mandatory: a ref field absent from the service select crashes at *query*
// time, not compile time (Critical on Story 3.4; re-flagged 3.5-4.1).
const ACTIVITY_SELECT = {
  id: true,
  type: true,
  title: true,
  description: true,
  createdAt: true,
  createdBy: true,
  source: true,
} as const

// Story 4.4 (AC 10): the tenant-wide feed needs two more fields than the
// contact timeline — `sourceId` and the parent contact identity. Declared as
// a SEPARATE select so ACTIVITY_SELECT / findByContact stay untouched (an
// unrequested payload change on a hot path).
const ACTIVITY_FEED_SELECT = {
  ...ACTIVITY_SELECT,
  contactId: true,
  sourceId: true,
  contact: { select: { id: true, firstName: true, lastName: true } },
} as const

export type ActivityFeedItem = Prisma.ActivityGetPayload<{ select: typeof ACTIVITY_FEED_SELECT }>

// Story 4.4 (AC 16): the insert select that also fetches the parent contact's
// ownerId in the same round-trip, so onActivityLogged can filter in memory.
const ACTIVITY_LOG_SELECT = {
  id: true,
  tenantId: true,
  contactId: true,
  type: true,
  title: true,
  description: true,
  createdAt: true,
  createdBy: true,
  source: true,
  sourceId: true,
  dedupeKey: true,
  contact: { select: { ownerId: true } },
} as const

export type ActivityFeedFilter = {
  type?: string
  source?: string
  contactId?: string
  createdBy?: string
  createdFrom?: string
  createdTo?: string
  search?: string
}

export type ActivityFeedPagination = {
  page?: number
  pageSize?: number
}

export type ActivityFeedConnection = {
  items: ActivityFeedItem[]
  total: number
  page: number
  pageSize: number
}

export type ActivityFeedStats = {
  todayCount: number
  weekCount: number
}

const FEED_DEFAULT_PAGE = 1
const FEED_DEFAULT_PAGE_SIZE = 20
const FEED_MAX_PAGE_SIZE = 100
const MS_PER_DAY = 24 * 60 * 60 * 1000

@Injectable()
export class ActivityService {
  private readonly logger = new Logger('ActivityService')

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly activityPubSub: ActivityPubSubService,
  ) {}

  /**
   * Story 4.4 (AC 19): best-effort onActivityLogged publish. Publishing must
   * never fail the mutation — same discipline as syncCalendarSafe / logSafe.
   */
  private publishActivityLogged(tenantId: string, payload: unknown): void {
    try {
      this.activityPubSub.publish(`${PUBSUB_ACTIVITY_LOGGED}:${tenantId}`, payload)
    } catch {
      // Swallowed — the insert must succeed (AC 19).
    }
  }

  /**
   * Create an activity record. Validates required fields.
   */
  async log(input: CreateActivityInput): Promise<{
    id: string
    tenantId: string
    contactId: string
    type: string
    title: string
    description: string | null
    createdAt: Date
    createdBy: string
    source: string | null
    sourceId: string | null
    dedupeKey: string | null
    contact: { ownerId: string } | null
  }> {
    if (!input.tenantId) throw new BadRequestException('tenantId is required')
    if (!input.contactId) throw new BadRequestException('contactId is required')
    if (!input.type) throw new BadRequestException('type is required')
    if (!input.title) throw new BadRequestException('title is required')

    // Story 4.4 (AC 16): the parent contact's ownerId is fetched in the SAME
    // insert round-trip so onActivityLogged can compare visibility in memory
    // with zero per-event database reads (AC 15).
    const activity = await this.prisma.activity.create({
      data: {
        tenantId: input.tenantId,
        contactId: input.contactId,
        type: input.type,
        title: input.title,
        description: input.description ?? null,
        createdBy: input.createdBy,
        source: input.source ?? null,
        sourceId: input.sourceId ?? null,
        dedupeKey: input.dedupeKey ?? null,
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
      select: ACTIVITY_LOG_SELECT,
    })

    // Publish AFTER the insert, outside any $transaction, and never fail the
    // mutation on a publish error (AC 19). contactOwnerId is transport-internal
    // only — ActivityRef never exposes it.
    this.publishActivityLogged(activity.tenantId, {
      ...activity,
      contactOwnerId: activity.contact?.ownerId ?? null,
    })

    return activity
  }

  /**
   * Safe logging wrapper that never throws — used by the auto-logging hooks so
   * the primary operation is never blocked (Story 5.4 "safe" decision; AC 13).
   * - Prisma P2002 on the dedupeKey unique is an *expected* dedup hit → debug.
   * - Any other error → warn with the message.
   * Never uses `(error as Error).message` — a non-Error throw would yield
   * `undefined` (finding 3.7-F6).
   */
  async logSafe(input: CreateActivityInput): Promise<{
    id: string
    tenantId: string
    contactId: string
    type: string
    title: string
    description: string | null
    createdAt: Date
    createdBy: string
    source: string | null
    sourceId: string | null
    dedupeKey: string | null
  } | null> {
    try {
      return await this.log(input)
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
        this.logger.debug(
          `Duplicate activity suppressed (dedupeKey hit): ${input.dedupeKey ?? 'unknown'}`,
        )
        return null
      }
      this.logger.warn(
        `Activity auto-log failed: ${error instanceof Error ? error.message : String(error)}`,
      )
      return null
    }
  }

  /**
   * Manually log a note on a contact (the addContactNote mutation) and audit
   * it (AC 43). Unlike auto-logged activities, a manual note IS audited: the
   * global AuditInterceptor never fires for GraphQL mutations in this repo
   * (AC 42), so this service-level write is the only path that produces an
   * AuditLog row. Auto-logged activities themselves are NOT audited — they are
   * derived records whose originating mutation is already audited (AC 44).
   */
  async addContactNote(input: {
    tenantId: string
    contactId: string
    title: string
    description?: string | null
    userId: string
  }): Promise<{
    id: string
    tenantId: string
    contactId: string
    type: string
    title: string
    description: string | null
    createdAt: Date
    createdBy: string
    source: string | null
    sourceId: string | null
    dedupeKey: string | null
  }> {
    const activity = await this.log({
      tenantId: input.tenantId,
      contactId: input.contactId,
      type: 'NOTE_ADDED',
      title: input.title,
      description: input.description ?? null,
      createdBy: input.userId,
    })

    await this.audit.log({
      tenantId: input.tenantId,
      userId: input.userId,
      action: 'CREATE',
      entity: 'ACTIVITY',
      entityId: activity.id,
      details: { mutationName: 'CREATE' },
    })

    return activity
  }

  /**
   * Paginated timeline query sorted by createdAt DESC.
   * Uses cursor-based pagination with `take: first + 1` pattern to detect hasNextPage.
   * When includeTotalCount is true, runs findMany + count in a single $transaction.
   */
  async findByContact(
    tenantId: string,
    contactId: string,
    args: TimelineQueryArgs = {},
  ): Promise<ContactTimelineResult> {
    const first = Math.min(Math.max(args.first ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)
    const after = args.after

    const baseQuery: Parameters<typeof this.prisma.activity.findMany>[0] = {
      where: { tenantId, contactId },
      orderBy: { createdAt: 'desc' },
      take: first + 1,
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
      select: ACTIVITY_SELECT,
    }

    const mapEdges = (activities: Array<Record<string, unknown>>): ActivityTimelineEdge[] =>
      activities.map((a) => ({
        cursor: a.id as string,
        node: {
          id: a.id as string,
          type: a.type as string,
          title: a.title as string,
          description: (a.description as string | null) ?? null,
          createdAt: (a.createdAt as Date).toISOString(),
          createdBy: a.createdBy as string,
          source: (a.source as string | null) ?? null,
        },
      }))

    if (args.includeTotalCount) {
      const [activities, totalCount] = await this.prisma.$transaction([
        this.prisma.activity.findMany(baseQuery),
        this.prisma.activity.count({ where: { tenantId, contactId } }),
      ])

      const hasNextPage = activities.length > first
      const edges = hasNextPage ? activities.slice(0, first) : activities

      return {
        edges: mapEdges(edges as Array<Record<string, unknown>>),
        pageInfo: {
          hasNextPage,
          endCursor: edges.length > 0 ? (edges[edges.length - 1]!.id as string) : null,
        },
        totalCount,
      }
    }

    const activities = await this.prisma.activity.findMany(baseQuery)

    const hasNextPage = activities.length > first
    const edges = hasNextPage ? activities.slice(0, first) : activities

    return {
      edges: mapEdges(edges as Array<Record<string, unknown>>),
      pageInfo: {
        hasNextPage,
        endCursor: edges.length > 0 ? (edges[edges.length - 1]!.id as string) : null,
      },
      totalCount: 0, // Not computed by default to avoid extra query
    }
  }

  /**
   * Count activities for a contact (used for the "N activities" header).
   */
  async countByContact(tenantId: string, contactId: string): Promise<number> {
    return this.prisma.activity.count({
      where: { tenantId, contactId },
    })
  }

  /**
   * Story 4.4 (AC 4-10): tenant-wide, visibility-scoped activity feed.
   * Returns the house connection shape `{ items, total, page, pageSize }`
   * (offset pagination — the List view needs page numbers; the Timeline view
   * uses the same query with a larger page size and appends).
   *
   * Access derives from the parent Contact (Activity has no ownerId): the
   * same predicate checkContactAccess encodes for a single record, lifted to
   * a list filter — resolveVisibilityFilter against `contact.ownerId`, OR'd
   * with `contactId IN resolveSharedRecordIds`. When visibility is undefined
   * (ADMIN / DATA:VIEW_ALL / ALL) no owner predicate is applied at all.
   * `where` always starts `{ tenantId }` and the contact must not be
   * soft-deleted — there is no RLS; this predicate is the only isolation.
   */
  async findFeed(
    tenantId: string,
    userId: string,
    filter: ActivityFeedFilter = {},
    pagination: ActivityFeedPagination = {},
  ): Promise<ActivityFeedConnection> {
    const page = Math.max(pagination.page ?? FEED_DEFAULT_PAGE, 1)
    const pageSize = Math.min(
      Math.max(pagination.pageSize ?? FEED_DEFAULT_PAGE_SIZE, 1),
      FEED_MAX_PAGE_SIZE,
    )

    const where = await this.buildFeedWhere(tenantId, userId, filter)

    const [items, total] = await Promise.all([
      this.prisma.activity.findMany({
        where,
        // AC 9: the id tiebreaker is not decoration — auto-logged activities
        // are written in bursts and share a createdAt to the millisecond; an
        // unstable sort drops/duplicates rows across offset pages.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: ACTIVITY_FEED_SELECT,
      }),
      this.prisma.activity.count({ where }),
    ])

    return {
      items: items as ActivityFeedItem[],
      total,
      page,
      pageSize,
    }
  }

  /**
   * Shared where-builder for findFeed / getFeedStats (AC 5).
   */
  private async buildFeedWhere(
    tenantId: string,
    userId: string,
    filter: ActivityFeedFilter,
  ): Promise<Prisma.ActivityWhereInput> {
    const visibilityFilter = await resolveVisibilityFilter(userId, tenantId)
    const sharedIds = await resolveSharedRecordIds(userId, tenantId, 'CONTACT')

    const where: Prisma.ActivityWhereInput = {
      tenantId,
      contact: { deletedAt: null },
    }

    // Ownership ⊕ sharing OR-predicate (AC 5). `undefined` visibility (ADMIN /
    // ALL / DATA:VIEW_ALL) applies no owner predicate at all.
    const or: Prisma.ActivityWhereInput[] = []
    if (visibilityFilter !== undefined) {
      or.push({
        contact: { ownerId: visibilityFilter as Prisma.ContactWhereInput['ownerId'] },
      })
    }
    if (sharedIds.length > 0) {
      or.push({ contactId: { in: sharedIds } })
    }
    if (or.length > 0) {
      where.OR = or
    }

    const andConditions: Prisma.ActivityWhereInput[] = []

    if (filter.type) {
      andConditions.push({ type: filter.type as ActivityType })
    }
    if (filter.source) {
      andConditions.push({ source: filter.source })
    }
    if (filter.contactId) {
      andConditions.push({ contactId: filter.contactId })
    }
    if (filter.createdBy) {
      andConditions.push({ createdBy: filter.createdBy })
    }
    if (filter.createdFrom || filter.createdTo) {
      const dateFilter: Prisma.DateTimeFilter = {}
      if (filter.createdFrom) {
        dateFilter.gte = new Date(filter.createdFrom)
      }
      if (filter.createdTo) {
        // AC 8: inclusive of the whole final day — exactly as buildTaskWhere.
        const endDate = new Date(filter.createdTo)
        endDate.setHours(23, 59, 59, 999)
        dateFilter.lte = endDate
      }
      andConditions.push({ createdAt: dateFilter })
    }
    if (filter.search?.trim()) {
      andConditions.push({
        title: { contains: filter.search.trim(), mode: 'insensitive' },
      })
    }

    if (andConditions.length > 0) {
      where.AND = andConditions
    }

    return where
  }

  /**
   * Story 4.4 (AC 11): activity counters for the workspace metric strip.
   * ONLY the activity side — the task counters come from TasksService.getStats
   * (same visibility scope, same toUtcMidnight day maths) and are composed in
   * the GraphQL resolver. TasksService is deliberately NOT injected here:
   * TasksService already injects ActivityService, so doing so would close a DI
   * cycle (T8b).
   */
  async getFeedStats(
    tenantId: string,
    userId: string,
    now: Date = new Date(),
  ): Promise<ActivityFeedStats> {
    const baseWhere = await this.buildFeedWhere(tenantId, userId, {})

    const todayStart = toUtcMidnight(now)
    const todayEnd = new Date(todayStart.getTime() + MS_PER_DAY)
    const sevenDaysAgo = new Date(now.getTime() - 7 * MS_PER_DAY)

    const [todayCount, weekCount] = await Promise.all([
      this.prisma.activity.count({
        where: { ...baseWhere, createdAt: { gte: todayStart, lt: todayEnd } },
      }),
      this.prisma.activity.count({
        where: { ...baseWhere, createdAt: { gte: sevenDaysAgo } },
      }),
    ])

    return { todayCount, weekCount }
  }

  /**
   * Verify the authenticated user has access to view/modify a contact's activities.
   * Checks: (1) contact exists and belongs to tenant, (2) user's visibility rules,
   * (3) sharing rules. Throws NotFoundException if no access.
   */
  async checkContactAccess(tenantId: string, userId: string, contactId: string): Promise<void> {
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, tenantId, deletedAt: null },
      select: { id: true, ownerId: true },
    })

    if (!contact) {
      throw new NotFoundException('Contact not found')
    }

    const visibilityFilter = await resolveVisibilityFilter(userId, tenantId)
    const sharedIds = await resolveSharedRecordIds(userId, tenantId, 'CONTACT')

    let hasAccess = false

    if (visibilityFilter === undefined) {
      hasAccess = true // ALL/ADMIN bypass
    } else if (typeof visibilityFilter === 'string') {
      hasAccess = contact.ownerId === visibilityFilter
    } else {
      const allowedIds = (visibilityFilter as { in: string[] }).in
      hasAccess = allowedIds.includes(contact.ownerId)
    }

    // Check sharing (OR logic)
    if (!hasAccess && sharedIds.includes(contactId)) {
      hasAccess = true
    }

    if (!hasAccess) {
      throw new NotFoundException('Contact not found')
    }
  }

  /**
   * Detect meaningful changed fields between old and new contact records.
   * Excludes system fields (updatedAt, updatedBy, deletedAt, ownerId, id).
   */
  detectChangedFields(
    oldContact: Record<string, unknown>,
    newContact: Record<string, unknown>,
  ): string[] {
    const changed: string[] = []

    for (const key of Object.keys(newContact)) {
      if (EXCLUDED_FIELDS.has(key)) continue
      const oldVal = oldContact[key]
      const newVal = newContact[key]
      if (String(oldVal ?? '') !== String(newVal ?? '')) {
        changed.push(key)
      }
    }

    return changed
  }
}
