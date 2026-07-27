import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { ActivityType } from '@prisma/client'

import { PrismaService } from '../prisma/prisma.service'
import { resolveVisibilityFilter } from '../common/guards/visibility-check'
import { resolveSharedRecordIds } from '../common/guards/sharing-check'

export type CreateActivityInput = {
  tenantId: string
  contactId: string
  type: ActivityType
  title: string
  description?: string | null
  createdBy: string
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
const EXCLUDED_FIELDS = new Set(['updatedAt', 'updatedBy', 'deletedAt', 'ownerId', 'id', 'createdAt'])

const ACTIVITY_SELECT = {
  id: true,
  type: true,
  title: true,
  description: true,
  createdAt: true,
  createdBy: true,
} as const

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

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
      },
    })
  }

  /**
   * Safe logging wrapper that never throws — logs failure silently.
   * Used by auto-logging hooks so the primary operation is never blocked.
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
  } | null> {
    try {
      return await this.log(input)
    } catch {
      return null
    }
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

    if (args.includeTotalCount) {
      const [activities, totalCount] = await this.prisma.$transaction([
        this.prisma.activity.findMany(baseQuery),
        this.prisma.activity.count({ where: { tenantId, contactId } }),
      ])

      const hasNextPage = activities.length > first
      const edges = hasNextPage ? activities.slice(0, first) : activities

      return {
        edges: edges.map((a) => ({
          cursor: a.id,
          node: {
            id: a.id,
            type: a.type,
            title: a.title,
            description: a.description,
            createdAt: a.createdAt.toISOString(),
            createdBy: a.createdBy,
          },
        })),
        pageInfo: {
          hasNextPage,
          endCursor: edges.length > 0 ? edges[edges.length - 1]!.id : null,
        },
        totalCount,
      }
    }

    const activities = await this.prisma.activity.findMany(baseQuery)

    const hasNextPage = activities.length > first
    const edges = hasNextPage ? activities.slice(0, first) : activities

    return {
      edges: edges.map((a) => ({
        cursor: a.id,
        node: {
          id: a.id,
          type: a.type,
          title: a.title,
          description: a.description,
          createdAt: a.createdAt.toISOString(),
          createdBy: a.createdBy,
        },
      })),
      pageInfo: {
        hasNextPage,
        endCursor: edges.length > 0 ? edges[edges.length - 1]!.id : null,
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
