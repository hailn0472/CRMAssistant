import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'
import { DealsService } from '../deals/deals.service'
import { DealPubSubService } from '../deals/deal-pubsub.service'
import { MAX_COMMENT_LENGTH, extractMentionedUserIds } from './mention-parse'

export const PUBSUB_DEAL_COMMENT_ADDED = 'DEAL_COMMENT_ADDED'

export type AddDealCommentInput = {
  dealId: string
  comment: string
}

export type DealCommentPaginationInput = {
  page?: number
  pageSize?: number
}

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 100

/**
 * Nested author + mentions select — every field DealCommentRef exposes (AC 27).
 * The nested-ref crash from Story 3.4 happened exactly here: a ref exposing
 * fields the include did not select. Keep this include in lockstep with the
 * Pothos refs.
 */
const COMMENT_INCLUDE: Record<string, unknown> = {
  author: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      avatar: true,
    },
  },
  mentions: {
    include: {
      mentionedUser: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          avatar: true,
        },
      },
    },
  },
}

/**
 * Deal comments and @mentions (Story 3.6).
 *
 * Mentions use the explicit token `@[Display Name](userId)`. `add` extracts the
 * embedded ids, filters them to users that exist in the same tenant with
 * `deletedAt: null`, and writes one `DealCommentMention` per surviving id in
 * the same transaction as the comment insert. Unknown or cross-tenant ids are
 * dropped silently — they must never 400 the comment and must never produce a
 * mention row (a mention of a deactivated colleague should still post).
 *
 * The fully-hydrated comment is published only AFTER the transaction commits,
 * so a subscriber never receives a payload whose nested refs resolve to
 * undefined.
 */
@Injectable()
export class DealCommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deals: DealsService,
    private readonly dealPubSub: DealPubSubService,
  ) {}

  async add(
    tenantId: string,
    userId: string,
    input: AddDealCommentInput,
  ): Promise<Record<string, unknown>> {
    // Deal access first — the single authorization primitive.
    await this.deals.findOne(tenantId, userId, input.dealId)

    const comment = input.comment.trim()
    if (!comment) {
      throw new BadRequestException('comment is required')
    }
    if (comment.length > MAX_COMMENT_LENGTH) {
      throw new BadRequestException('comment must not exceed 5000 characters')
    }

    // Resolve mention ids against the tenant's active users — survivors only.
    const mentionIds = extractMentionedUserIds(comment)
    let survivingIds: string[] = []
    if (mentionIds.length > 0) {
      const users = await this.prisma.user.findMany({
        where: { tenantId, deletedAt: null, id: { in: mentionIds } },
        select: { id: true },
      })
      survivingIds = users.map((user) => user.id)
    }

    // One transaction: comment insert + mention rows.
    const created = await this.prisma.$transaction(async (tx) => {
      const commentRow = await tx.dealComment.create({
        data: {
          tenantId,
          dealId: input.dealId,
          userId,
          comment,
          createdBy: userId,
          updatedBy: userId,
        },
        include: COMMENT_INCLUDE,
      })
      if (survivingIds.length > 0) {
        await tx.dealCommentMention.createMany({
          data: survivingIds.map((mentionedUserId) => ({
            tenantId,
            commentId: commentRow.id,
            mentionedUserId,
          })),
        })
      }
      return commentRow
    })

    // Re-read hydrated so the published payload carries author + mentions.
    const hydrated = await this.prisma.dealComment.findFirst({
      where: { id: created.id, tenantId },
      include: COMMENT_INCLUDE,
    })

    this.dealPubSub.publish(
      `${PUBSUB_DEAL_COMMENT_ADDED}:${tenantId}:${input.dealId}`,
      hydrated ?? created,
    )

    return hydrated ?? created
  }

  async findManyForDeal(
    tenantId: string,
    userId: string,
    dealId: string,
    pagination: DealCommentPaginationInput = {},
  ): Promise<Record<string, unknown>> {
    await this.deals.findOne(tenantId, userId, dealId)

    const page = Math.max(pagination.page ?? DEFAULT_PAGE, 1)
    const pageSize = Math.min(Math.max(pagination.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)

    const [items, total] = await Promise.all([
      this.prisma.dealComment.findMany({
        where: { tenantId, dealId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: COMMENT_INCLUDE,
      }),
      this.prisma.dealComment.count({ where: { tenantId, dealId, deletedAt: null } }),
    ])

    return { items, total, page, pageSize }
  }

  async delete(
    tenantId: string,
    userId: string,
    id: string,
    callerRoles: string[],
  ): Promise<boolean> {
    const comment = await this.prisma.dealComment.findFirst({
      where: { id, tenantId, deletedAt: null },
    })
    if (!comment) {
      throw new NotFoundException('Comment not found')
    }

    // Re-verify the deal from the loaded row, never a client-supplied id.
    await this.deals.findOne(tenantId, userId, comment.dealId)

    if (comment.userId !== userId && !callerRoles.includes('ADMIN')) {
      throw new ForbiddenException('You can only delete your own comments')
    }

    await this.prisma.dealComment.updateMany({
      where: { id: comment.id, tenantId, deletedAt: null },
      data: { deletedAt: new Date(), updatedBy: userId },
    })

    return true
  }

  async mentionCandidates(
    tenantId: string,
    userId: string,
    dealId: string,
    search?: string,
  ): Promise<Record<string, unknown>[]> {
    await this.deals.findOne(tenantId, userId, dealId)

    const where: Record<string, unknown> = {
      tenantId,
      deletedAt: null,
      isActive: true,
    }
    const term = search?.trim()
    if (term) {
      where.OR = [
        { firstName: { contains: term, mode: 'insensitive' } },
        { lastName: { contains: term, mode: 'insensitive' } },
        { email: { contains: term, mode: 'insensitive' } },
      ]
    }

    return this.prisma.user.findMany({
      where,
      orderBy: { firstName: 'asc' },
      take: 50,
      select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
    })
  }
}
