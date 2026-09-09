import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common'
import { performance } from 'node:perf_hooks'

import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'

import { PrismaService } from '../prisma/prisma.service'
import { BACKGROUND_METRICS_PORT, type BackgroundMetricsPort } from '../observability/metrics.types'
import {
  NotificationPubSubService,
  PUBSUB_NOTIFICATION_CREATED,
} from './notification-pubsub.service'
import {
  assertValidNotificationType,
  resolveNotificationTarget,
  normalizeNotificationTitle,
  normalizeNotificationBody,
} from './notification-types'

export type CreateNotificationInput = {
  recipientUserId: string
  type: string
  title: string
  body?: string | null
  taskId?: string | null
  reportExportId?: string | null
  dedupeKey?: string | null
}

export type NotificationFilterInput = {
  unreadOnly?: boolean
}

export type NotificationPaginationInput = {
  page?: number
  pageSize?: number
}

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

/**
 * Every field the Pothos NotificationRef exposes must be in this select.
 * A ref field the select omits crashes at query time, not compile time (Trap T1).
 */
export const NOTIFICATION_SELECT = {
  id: true,
  tenantId: true,
  userId: true,
  type: true,
  title: true,
  body: true,
  taskId: true,
  reportExportId: true,
  dedupeKey: true,
  readAt: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  deletedAt: true,
} as const

export interface NotificationRecord {
  id: string
  tenantId: string
  userId: string
  type: string
  title: string
  body: string | null
  taskId: string | null
  reportExportId: string | null
  dedupeKey: string | null
  readAt: Date | null
  createdAt: Date
  updatedAt: Date
  createdBy: string
  updatedBy: string
  deletedAt: Date | null
}

export interface NotificationConnectionResult {
  items: NotificationRecord[]
  total: number
  page: number
  pageSize: number
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('NotificationsService')

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationPubSub: NotificationPubSubService,
    @Optional()
    @Inject(BACKGROUND_METRICS_PORT)
    private readonly backgroundMetrics?: BackgroundMetricsPort,
  ) {}

  /**
   * Create a notification row and publish on the own-scoped channel.
   * On a P2002 (dedupeKey collision) returns the existing row without publishing.
   */
  async create(
    tenantId: string,
    actorUserId: string,
    input: CreateNotificationInput,
  ): Promise<NotificationRecord> {
    const { notification } = await this.createWithStatus(tenantId, actorUserId, input)
    return notification
  }

  /**
   * createWithStatus — like `create` but also reports whether a NEW row was
   * actually inserted (`created: true`) or the call was deduped on an
   * existing dedupeKey (`created: false`). Background processors use this to
   * count real notifications only (M5: `notificationsCreated` must not
   * over-count on dedupe).
   */
  private async createWithStatus(
    tenantId: string,
    actorUserId: string,
    input: CreateNotificationInput,
  ): Promise<{ notification: NotificationRecord; created: boolean }> {
    assertValidNotificationType(input.type)
    resolveNotificationTarget({
      taskId: input.taskId,
      reportExportId: input.reportExportId,
    })
    const title = normalizeNotificationTitle(input.title)
    const body = normalizeNotificationBody(input.body)

    try {
      const row = await this.prisma.notification.create({
        data: {
          tenantId,
          userId: input.recipientUserId,
          type: input.type,
          title,
          body,
          taskId: input.taskId ?? null,
          reportExportId: input.reportExportId ?? null,
          dedupeKey: input.dedupeKey ?? null,
          createdBy: actorUserId,
          updatedBy: actorUserId,
        },
        select: NOTIFICATION_SELECT,
      })

      const notification = row as unknown as NotificationRecord

      this.notificationPubSub.publish(
        `${PUBSUB_NOTIFICATION_CREATED}:${tenantId}:${input.recipientUserId}`,
        notification,
      )

      return { notification, created: true }
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
        // dedupeKey collision — return the existing row, do not publish
        const existing = await this.prisma.notification.findFirst({
          where: {
            tenantId,
            dedupeKey: input.dedupeKey ?? undefined,
            deletedAt: null,
          },
          select: NOTIFICATION_SELECT,
        })
        if (existing) {
          return { notification: existing as unknown as NotificationRecord, created: false }
        }
        // existing row was soft-deleted; fall through to create a new one
        const row = await this.prisma.notification.create({
          data: {
            tenantId,
            userId: input.recipientUserId,
            type: input.type,
            title,
            body,
            taskId: input.taskId ?? null,
            reportExportId: input.reportExportId ?? null,
            dedupeKey: input.dedupeKey ?? null,
            createdBy: actorUserId,
            updatedBy: actorUserId,
          },
          select: NOTIFICATION_SELECT,
        })

        const notification = row as unknown as NotificationRecord

        this.notificationPubSub.publish(
          `${PUBSUB_NOTIFICATION_CREATED}:${tenantId}:${input.recipientUserId}`,
          notification,
        )

        return { notification, created: true }
      }
      throw error
    }
  }

  /**
   * Safe notification wrapper that never throws — this is the ONLY method
   * producers call. Logs at error level and swallows (AC 18). Resolves
   * `true` when a NEW notification row was actually created, `false` when
   * the call was deduped on an existing dedupeKey (P2002) or failed (M5).
   */
  async notifySafe(
    tenantId: string,
    actorUserId: string,
    input: CreateNotificationInput,
  ): Promise<boolean> {
    const startedAt = performance.now()
    try {
      const { created } = await this.createWithStatus(tenantId, actorUserId, input)
      this.recordBackgroundJob('success', performance.now() - startedAt)
      return created
    } catch (error) {
      this.recordBackgroundJob('error', performance.now() - startedAt)
      this.logger.error(
        `Notification create failed: ${error instanceof Error ? error.message : String(error)}`,
      )
      return false
    }
  }

  private recordBackgroundJob(outcome: 'success' | 'error', durationMilliseconds: number): void {
    const labels = { jobGroup: 'notification' as const, outcome }
    try {
      this.backgroundMetrics?.recordJob(labels)
    } catch {
      // Observability must never change notification business behavior.
    }
    try {
      this.backgroundMetrics?.observeJobDuration(labels, Math.max(0, durationMilliseconds) / 1_000)
    } catch {
      // Observability must never change notification business behavior.
    }
  }

  async findMany(
    tenantId: string,
    userId: string,
    filter: NotificationFilterInput = {},
    pagination: NotificationPaginationInput = {},
  ): Promise<NotificationConnectionResult> {
    const page = Math.max(pagination.page ?? DEFAULT_PAGE, 1)
    const pageSize = Math.min(Math.max(pagination.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)

    const where: Record<string, unknown> = {
      tenantId,
      userId,
      deletedAt: null,
    }

    if (filter.unreadOnly) {
      where.readAt = null
    }

    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: NOTIFICATION_SELECT,
      }),
      this.prisma.notification.count({ where }),
    ])

    return { items: items as unknown as NotificationRecord[], total, page, pageSize }
  }

  async countUnread(tenantId: string, userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { tenantId, userId, readAt: null, deletedAt: null },
    })
  }

  async markRead(tenantId: string, userId: string, id: string): Promise<NotificationRecord> {
    const result = await this.prisma.notification.updateMany({
      where: { id, tenantId, userId, readAt: null, deletedAt: null },
      data: { readAt: new Date(), updatedBy: userId },
    })

    if (result.count === 0) {
      // Re-read — may be already-read (idempotent), not-yours or soft-deleted
      const existing = await this.prisma.notification.findFirst({
        where: { id, tenantId, userId, deletedAt: null },
        select: NOTIFICATION_SELECT,
      })
      if (existing) {
        return existing as unknown as NotificationRecord
      }
      throw new NotFoundException('Notification not found')
    }

    const updated = await this.prisma.notification.findFirst({
      where: { id, tenantId, userId, deletedAt: null },
      select: NOTIFICATION_SELECT,
    })

    return updated as unknown as NotificationRecord
  }

  async markAllRead(tenantId: string, userId: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { tenantId, userId, readAt: null, deletedAt: null },
      data: { readAt: new Date(), updatedBy: userId },
    })
    return result.count
  }
}
