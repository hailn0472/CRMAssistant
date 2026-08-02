import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'
import type { ActivityType, Prisma } from '@prisma/client'

import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { resolveVisibilityFilter } from '../common/guards/visibility-check'
import { resolveSharedRecordIds } from '../common/guards/sharing-check'

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

@Injectable()
export class ActivityService {
  private readonly logger = new Logger('ActivityService')

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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
  }> {
    if (!input.tenantId) throw new BadRequestException('tenantId is required')
    if (!input.contactId) throw new BadRequestException('contactId is required')
    if (!input.type) throw new BadRequestException('type is required')
    if (!input.title) throw new BadRequestException('title is required')

    return this.prisma.activity.create({
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
    })
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
