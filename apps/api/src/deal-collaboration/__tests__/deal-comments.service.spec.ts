import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'

import { DealCommentsService } from '../deal-comments.service'
import { MAX_COMMENT_LENGTH } from '../mention-parse'
import type { PrismaService } from '../../prisma/prisma.service'
import type { DealsService } from '../../deals/deals.service'
import type { DealPubSubService } from '../../deals/deal-pubsub.service'
import type { NotificationsService } from '../../notifications/notifications.service'

const mockAuthor = {
  id: 'user-1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  avatar: null,
}

const mockMentioned = {
  id: 'user-2',
  firstName: 'Grace',
  lastName: 'Hopper',
  email: 'grace@example.com',
  avatar: null,
}

const mockComment = {
  id: 'comment-1',
  tenantId: 'tenant-1',
  dealId: 'deal-1',
  userId: 'user-1',
  comment: 'cc @[Grace Hopper](user-2)',
  createdAt: new Date('2026-07-31T00:00:00.000Z'),
  updatedAt: new Date('2026-07-31T00:00:00.000Z'),
  createdBy: 'user-1',
  updatedBy: 'user-1',
  deletedAt: null,
  author: mockAuthor,
  mentions: [
    {
      id: 'mention-1',
      tenantId: 'tenant-1',
      commentId: 'comment-1',
      mentionedUserId: 'user-2',
      createdAt: new Date('2026-07-31T00:00:00.000Z'),
      mentionedUser: mockMentioned,
    },
  ],
}

function makePrismaMock(): {
  dealComment: {
    create: jest.Mock
    findFirst: jest.Mock
    updateMany: jest.Mock
    findMany: jest.Mock
    count: jest.Mock
  }
  dealCommentMention: { createMany: jest.Mock }
  user: { findMany: jest.Mock }
  $transaction: jest.Mock
} {
  const prisma = {
    dealComment: {
      create: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    dealCommentMention: { createMany: jest.fn() },
    user: { findMany: jest.fn() },
    $transaction: jest.fn(),
  }
  // Self-referencing transaction mock: tx.dealComment.create === prisma.dealComment.create
  // so existing mockResolvedValue setups keep working inside the interactive transaction.
  prisma.$transaction.mockImplementation(
    (cb: (tx: ReturnType<typeof makePrismaMock>) => Promise<unknown>) => cb(prisma),
  )
  return prisma
}

function makeDealsMock(): { findOne: jest.Mock } {
  return { findOne: jest.fn() }
}

function makePubSubMock(): { publish: jest.Mock } {
  return { publish: jest.fn() }
}

describe('DealCommentsService', () => {
  let prisma: ReturnType<typeof makePrismaMock>
  let deals: ReturnType<typeof makeDealsMock>
  let pubSub: ReturnType<typeof makePubSubMock>
  let service: DealCommentsService

  beforeEach(() => {
    prisma = makePrismaMock()
    deals = makeDealsMock()
    pubSub = makePubSubMock()
    service = new DealCommentsService(
      prisma as unknown as PrismaService,
      deals as unknown as DealsService,
      pubSub as unknown as DealPubSubService,
      { notifySafe: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService,
    )
    deals.findOne.mockResolvedValue({ id: 'deal-1' })
  })

  describe('add', () => {
    it('verifies deal access, trims and rejects an empty comment', async () => {
      await expect(
        service.add('tenant-1', 'user-1', { dealId: 'deal-1', comment: '   ' }),
      ).rejects.toThrow(new BadRequestException('comment is required'))
      expect(deals.findOne).toHaveBeenCalledWith('tenant-1', 'user-1', 'deal-1')
      expect(prisma.dealComment.create).not.toHaveBeenCalled()
    })

    it('rejects a comment over 5000 characters', async () => {
      await expect(
        service.add('tenant-1', 'user-1', {
          dealId: 'deal-1',
          comment: 'x'.repeat(MAX_COMMENT_LENGTH + 1),
        }),
      ).rejects.toThrow(new BadRequestException('comment must not exceed 5000 characters'))
      expect(prisma.dealComment.create).not.toHaveBeenCalled()
    })

    it('creates the comment, resolves mentions, re-reads hydrated and publishes after commit', async () => {
      prisma.user.findMany.mockResolvedValue([{ id: 'user-2' }])
      prisma.dealComment.create.mockResolvedValue(mockComment)
      prisma.dealComment.findFirst.mockResolvedValue(mockComment)

      const result = await service.add('tenant-1', 'user-1', {
        dealId: 'deal-1',
        comment: 'cc @[Grace Hopper](user-2)',
      })

      expect(prisma.dealComment.create).toHaveBeenCalledWith({
        data: {
          tenantId: 'tenant-1',
          dealId: 'deal-1',
          userId: 'user-1',
          comment: 'cc @[Grace Hopper](user-2)',
          createdBy: 'user-1',
          updatedBy: 'user-1',
        },
        include: expect.any(Object),
      })
      // One mention row per surviving id, inside the same transaction as the insert.
      expect(prisma.dealCommentMention.createMany).toHaveBeenCalledWith({
        data: [{ tenantId: 'tenant-1', commentId: 'comment-1', mentionedUserId: 'user-2' }],
      })
      // Re-read hydrated so nested refs are all present in the published payload.
      expect(prisma.dealComment.findFirst).toHaveBeenCalledWith({
        where: { id: 'comment-1', tenantId: 'tenant-1' },
        include: expect.any(Object),
      })
      expect(pubSub.publish).toHaveBeenCalledWith('DEAL_COMMENT_ADDED:tenant-1:deal-1', mockComment)
      expect(result).toEqual(mockComment)
    })

    it('drops cross-tenant or unknown mention ids silently', async () => {
      prisma.user.findMany.mockResolvedValue([{ id: 'user-2' }])
      prisma.dealComment.create.mockResolvedValue(mockComment)
      prisma.dealComment.findFirst.mockResolvedValue(mockComment)

      await service.add('tenant-1', 'user-1', {
        dealId: 'deal-1',
        comment: '@[Grace Hopper](user-2) @[Stranger](other-tenant-user)',
      })

      // Resolution filtered against tenant-1 active users — the stranger is dropped.
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          deletedAt: null,
          id: { in: ['user-2', 'other-tenant-user'] },
        },
        select: { id: true },
      })
      expect(prisma.dealCommentMention.createMany).toHaveBeenCalledWith({
        data: [{ tenantId: 'tenant-1', commentId: 'comment-1', mentionedUserId: 'user-2' }],
      })
    })

    it('writes no mention rows for a comment without mentions', async () => {
      prisma.dealComment.create.mockResolvedValue({ ...mockComment, comment: 'plain' })
      prisma.dealComment.findFirst.mockResolvedValue({ ...mockComment, comment: 'plain' })

      await service.add('tenant-1', 'user-1', { dealId: 'deal-1', comment: 'plain' })

      expect(prisma.user.findMany).not.toHaveBeenCalled()
      expect(prisma.dealCommentMention.createMany).not.toHaveBeenCalled()
      expect(pubSub.publish).toHaveBeenCalledWith('DEAL_COMMENT_ADDED:tenant-1:deal-1', {
        ...mockComment,
        comment: 'plain',
      })
    })

    it('never publishes when the deal is not visible', async () => {
      deals.findOne.mockRejectedValue(new NotFoundException('Deal not found'))

      await expect(
        service.add('tenant-1', 'user-1', { dealId: 'deal-1', comment: 'hi' }),
      ).rejects.toThrow(new NotFoundException('Deal not found'))
      expect(pubSub.publish).not.toHaveBeenCalled()
    })
  })

  describe('delete', () => {
    it('lets the author delete their own comment', async () => {
      prisma.dealComment.findFirst.mockResolvedValue(mockComment)
      prisma.dealComment.updateMany.mockResolvedValue({ count: 1 })

      const result = await service.delete('tenant-1', 'user-1', 'comment-1', ['SALES_REP'])

      expect(deals.findOne).toHaveBeenCalledWith('tenant-1', 'user-1', 'deal-1')
      expect(prisma.dealComment.updateMany).toHaveBeenCalledWith({
        where: { id: 'comment-1', tenantId: 'tenant-1', deletedAt: null },
        data: { deletedAt: expect.any(Date), updatedBy: 'user-1' },
      })
      expect(result).toBe(true)
    })

    it('lets an ADMIN delete someone elses comment', async () => {
      prisma.dealComment.findFirst.mockResolvedValue(mockComment)
      prisma.dealComment.updateMany.mockResolvedValue({ count: 1 })

      await expect(service.delete('tenant-1', 'user-9', 'comment-1', ['ADMIN'])).resolves.toBe(true)
    })

    it('forbids a non-author without ADMIN', async () => {
      prisma.dealComment.findFirst.mockResolvedValue(mockComment)

      await expect(
        service.delete('tenant-1', 'user-9', 'comment-1', ['SALES_REP']),
      ).rejects.toThrow(new ForbiddenException('You can only delete your own comments'))
      expect(prisma.dealComment.updateMany).not.toHaveBeenCalled()
    })

    it('throws Comment not found for a missing or soft-deleted row', async () => {
      prisma.dealComment.findFirst.mockResolvedValue(null)

      await expect(
        service.delete('tenant-1', 'user-1', 'comment-missing', ['SALES_REP']),
      ).rejects.toThrow(new NotFoundException('Comment not found'))
    })
  })

  describe('findManyForDeal', () => {
    it('resolves deal access and returns the connection ordered oldest-first', async () => {
      prisma.dealComment.findMany.mockResolvedValue([mockComment])
      prisma.dealComment.count.mockResolvedValue(1)

      const result = await service.findManyForDeal('tenant-1', 'user-1', 'deal-1', {
        page: 1,
        pageSize: 50,
      })

      expect(deals.findOne).toHaveBeenCalledWith('tenant-1', 'user-1', 'deal-1')
      expect(prisma.dealComment.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', dealId: 'deal-1', deletedAt: null },
        orderBy: { createdAt: 'asc' },
        skip: 0,
        take: 50,
        include: expect.any(Object),
      })
      expect(result).toEqual({ items: [mockComment], total: 1, page: 1, pageSize: 50 })
    })

    it('clamps pageSize at 100 and defaults page to 1', async () => {
      prisma.dealComment.findMany.mockResolvedValue([])
      prisma.dealComment.count.mockResolvedValue(0)

      await service.findManyForDeal('tenant-1', 'user-1', 'deal-1', { page: 3, pageSize: 999 })

      expect(prisma.dealComment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 200, take: 100 }),
      )
    })
  })

  describe('mentionCandidates', () => {
    it('verifies deal access then returns capped, firstName-ordered candidates', async () => {
      prisma.user.findMany.mockResolvedValue([mockMentioned])

      const result = await service.mentionCandidates('tenant-1', 'user-1', 'deal-1')

      expect(deals.findOne).toHaveBeenCalledWith('tenant-1', 'user-1', 'deal-1')
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', deletedAt: null, isActive: true },
        orderBy: { firstName: 'asc' },
        take: 50,
        select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
      })
      expect(result).toEqual([mockMentioned])
    })

    it('filters candidates case-insensitively across first name, last name and email', async () => {
      prisma.user.findMany.mockResolvedValue([mockMentioned])

      await service.mentionCandidates('tenant-1', 'user-1', 'deal-1', 'GRACE')

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: 'tenant-1',
            deletedAt: null,
            isActive: true,
            OR: [
              { firstName: { contains: 'GRACE', mode: 'insensitive' } },
              { lastName: { contains: 'GRACE', mode: 'insensitive' } },
              { email: { contains: 'GRACE', mode: 'insensitive' } },
            ],
          },
        }),
      )
    })

    it('does not query users for an invisible deal', async () => {
      deals.findOne.mockRejectedValue(new NotFoundException('Deal not found'))

      await expect(service.mentionCandidates('tenant-1', 'user-1', 'deal-1')).rejects.toThrow(
        new NotFoundException('Deal not found'),
      )
      expect(prisma.user.findMany).not.toHaveBeenCalled()
    })
  })
})
