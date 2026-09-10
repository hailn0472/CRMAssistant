import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import type { CalendarProvider, Prisma } from '@prisma/client'
import { performance } from 'node:perf_hooks'

import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { ActivityService } from '../activities/activities.service'
import { ActivityLogPreferenceService } from '../activities/activity-log-preference.service'
import { CalendarOAuthService } from './calendar-oauth.service'
import { CALENDAR_PROVIDERS } from './calendar-providers.token'
import type { CalendarProviderRegistry } from './calendar-providers.token'
import type { CalendarProviderContext, CalendarRemoteEvent } from './calendar-provider.types'
import { findCalendarConflict } from './calendar-conflict'
import { mapTaskToCalendarEvent } from './calendar-event-mapper'
import {
  BACKGROUND_METRICS_PORT,
  type BackgroundJobGroup,
  type BackgroundMetricsPort,
  type OutcomeLabel,
} from '../observability/metrics.types'

/**
 * Calendar sync engine (Story 4.3, AC 22-28).
 *
 * DI direction is one-way: `TasksService` → `CalendarSyncService`, never the
 * reverse. This service must NOT inject `TasksService` — its pull path writes
 * tasks through `PrismaService` directly (`updateMany` + an explicit
 * `AuditService.log`). This is the same one-way rule `FacebookHistorySyncService`
 * documents, and it is also the sync-loop guard: because the pull path never
 * re-enters `TasksService`, an inbound change can never bounce straight back
 * out as a push. Belt and braces: an inbound change whose `remoteUpdatedAt`
 * is not newer than the stored `remoteUpdatedAt` is skipped (AC 24).
 *
 * The only provider-specific branch anywhere is selecting the adapter from
 * `Record<CalendarProvider, CalendarProviderPort>` (AC 13).
 */

const PUSH_WINDOW_DURATION_MS = 30 * 60 * 1000 // 30-minute event window (AC 22)
const MAX_BACKOFF_MINUTES = 60 // nextAttemptAt = now + min(2^attemptCount, 60) min (AC 23)
const LAZY_SWEEP_THROTTLE_MS = 15 * 60 * 1000 // at most once per connection per 15 min (AC 26)
const SYSTEM_ACTOR = 'system'

export type CalendarTaskInput = {
  id: string
  tenantId: string
  title: string
  description: string | null
  status: string
  dueDate: Date | null
  assignedTo: string
  contactId: string | null
}

export type TaskCalendarSyncResult = {
  taskId: string
  syncStatus: string
  lastError: string | null
  externalEventId: string | null
  lastSyncedAt: string | null
  nextAttemptAt: string | null
  provider: string | null
  conflictSummary: string | null
}

type ConnectionWithTokens = {
  id: string
  tenantId: string
  userId: string
  provider: CalendarProvider
  accessTokenEncrypted: string | null
  refreshTokenEncrypted: string | null
  accessTokenExpiresAt: Date | null
  calendarId: string
  syncToken: string | null
  lastSyncedAt: Date | null
}

@Injectable()
export class CalendarSyncService {
  private readonly logger = new Logger(CalendarSyncService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly activity: ActivityService,
    private readonly activityLogPreference: ActivityLogPreferenceService,
    private readonly oauth: CalendarOAuthService,
    @Inject(CALENDAR_PROVIDERS)
    private readonly providers: CalendarProviderRegistry,
    @Optional()
    @Inject(BACKGROUND_METRICS_PORT)
    private readonly backgroundMetrics?: BackgroundMetricsPort,
  ) {}

  // ── Push (CRM → calendar) ──────────────────────────────────────────────

  /**
   * Best-effort push hook (AC 23), mirrored on `ActivityService.logSafe`:
   * swallows its own failures (logs at warn), records FAILED + lastError +
   * attemptCount+1 + nextAttemptAt on the link row, and can never fail the
   * calling task mutation. Hook sites in TasksService call this AFTER the
   * audit write and outside any $transaction.
   */
  async syncTaskSafe(task: CalendarTaskInput, now: Date = new Date()): Promise<void> {
    try {
      await this.measureBackgroundJob('calendar', () => this.pushTaskToAssigneeCalendars(task, now))
    } catch (error) {
      this.logger.warn(
        `Calendar sync failed for task ${task.id}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /** Best-effort remote removal + link cleanup (AC 23 complete/delete/assign). */
  async removeTaskFromCalendarSafe(task: CalendarTaskInput, now: Date = new Date()): Promise<void> {
    try {
      await this.measureBackgroundJob('calendar', () => this.removeTaskFromCalendar(task, now))
    } catch (error) {
      this.logger.warn(
        `Calendar removal failed for task ${task.id}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /** Explicit "Sync now" mutation (AC 31). Resolves visibility first — the
   * GraphQL resolver resolves the task through TasksService.findOne before
   * calling this. */
  async syncTaskToCalendar(
    task: CalendarTaskInput,
    now: Date = new Date(),
  ): Promise<TaskCalendarSyncResult> {
    await this.syncTaskSafe(task, now)
    const link = await this.prisma.taskCalendarEvent.findFirst({
      where: { tenantId: task.tenantId, taskId: task.id },
      orderBy: { updatedAt: 'desc' },
      include: { calendarConnection: { select: { provider: true } } },
    })
    if (!link) {
      return {
        taskId: task.id,
        syncStatus: 'PENDING',
        lastError: null,
        externalEventId: null,
        lastSyncedAt: null,
        nextAttemptAt: null,
        provider: null,
        conflictSummary: null,
      }
    }
    return this.toTaskCalendarSync(link)
  }

  /** Badge read (AC 45). Null when no link row exists yet. */
  async taskCalendarSync(tenantId: string, taskId: string): Promise<TaskCalendarSyncResult | null> {
    const link = await this.prisma.taskCalendarEvent.findFirst({
      where: { tenantId, taskId },
      orderBy: { updatedAt: 'desc' },
      include: { calendarConnection: { select: { provider: true } } },
    })
    return link ? this.toTaskCalendarSync(link) : null
  }

  // ── Pull (calendar → CRM) ──────────────────────────────────────────────

  /**
   * Syncs a single connection (AC 25): pulls provider changes, applies
   * task updates, persists the next sync token. A Google 410 GONE (reported
   * as `requiresFullResync` by the adapter) discards the stored token and
   * re-runs a full pass from scratch.
   */
  async syncConnection(connectionId: string, now: Date = new Date()): Promise<void> {
    const connection = await this.prisma.calendarConnection.findUnique({
      where: { id: connectionId },
    })
    if (!connection || connection.status !== 'ACTIVE' || connection.deletedAt) {
      return
    }

    const accessToken = await this.oauth.getValidAccessToken(connection, now)
    const ctx: CalendarProviderContext = {
      accessToken,
      calendarId: connection.calendarId,
      now,
    }

    let result = await this.providers[connection.provider].listChanges(ctx, connection.syncToken)

    if (result.requiresFullResync) {
      // 410 GONE — the stored token was invalidated server-side. Discard it
      // and re-run a full pass from scratch (AC 25).
      await this.prisma.calendarConnection.update({
        where: { id: connectionId },
        data: { syncToken: null, updatedBy: connection.userId },
      })
      result = await this.providers[connection.provider].listChanges(ctx, null)
    }

    // eslint-disable-next-line no-await-in-loop
    await this.applyInboundChanges(connection, result.changes)

    await this.prisma.calendarConnection.update({
      where: { id: connectionId },
      data: {
        syncToken: result.nextSyncToken,
        lastSyncedAt: now,
        lastSyncError: null,
        updatedBy: connection.userId,
      },
    })
  }

  /**
   * Sweeps every ACTIVE connection across all tenants. Never throws — called
   * from application bootstrap, so one connection failing must never block
   * startup or abort syncing the others (AC 26; facebook-history-sync pattern).
   */
  async syncAllConnections(): Promise<void> {
    await this.measureCalendarSweep(async (markFailed) => {
      const connections = await this.prisma.calendarConnection.findMany({
        where: { status: 'ACTIVE', deletedAt: null },
      })
      for (const connection of connections) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await this.syncConnection(connection.id)
        } catch (error) {
          markFailed()
          this.logger.error(
            `Calendar sync failed for connection ${connection.id}`,
            error instanceof Error ? error.stack : String(error),
          )
        }
      }
    })
  }

  /**
   * Lazily-triggered sweep for the caller's own connections only (AC 26),
   * throttled to at most once per connection per 15 minutes via
   * `lastSyncedAt`. Fired as `void`-ed from the calendarConnections query —
   * never awaited, and this method never throws.
   */
  async syncMine(tenantId: string, userId: string, now: Date = new Date()): Promise<void> {
    await this.measureCalendarSweep(async (markFailed) => {
      const connections = await this.prisma.calendarConnection.findMany({
        where: { tenantId, userId, status: 'ACTIVE', deletedAt: null },
      })
      for (const connection of connections) {
        if (
          connection.lastSyncedAt &&
          now.getTime() - connection.lastSyncedAt.getTime() < LAZY_SWEEP_THROTTLE_MS
        ) {
          continue
        }
        try {
          // eslint-disable-next-line no-await-in-loop
          await this.syncConnection(connection.id, now)
        } catch (error) {
          markFailed()
          this.logger.error(
            `Calendar sync failed for connection ${connection.id}`,
            error instanceof Error ? error.stack : String(error),
          )
        }
      }
    })
  }

  /** Records one aggregate sample per sweep while preserving isolated failures. */
  private async measureCalendarSweep(
    operation: (markFailed: () => void) => Promise<void>,
  ): Promise<void> {
    const startedAt = performance.now()
    let outcome: 'success' | 'error' = 'success'
    const markFailed = (): void => {
      outcome = 'error'
    }

    try {
      await operation(markFailed)
    } catch (error) {
      outcome = 'error'
      throw error
    } finally {
      this.recordBackgroundJob('calendar', outcome, performance.now() - startedAt)
    }
  }

  private async measureBackgroundJob<T>(
    jobGroup: BackgroundJobGroup,
    operation: () => Promise<T>,
  ): Promise<T> {
    const startedAt = performance.now()
    try {
      const result = await operation()
      this.recordBackgroundJob(jobGroup, 'success', performance.now() - startedAt)
      return result
    } catch (error) {
      this.recordBackgroundJob(jobGroup, 'error', performance.now() - startedAt)
      throw error
    }
  }

  private recordBackgroundJob(
    jobGroup: BackgroundJobGroup,
    outcome: OutcomeLabel,
    durationMilliseconds: number,
  ): void {
    const labels = { jobGroup, outcome }
    try {
      this.backgroundMetrics?.recordJob(labels)
    } catch {
      // Observability must never change calendar business behavior.
    }
    try {
      this.backgroundMetrics?.observeJobDuration(labels, Math.max(0, durationMilliseconds) / 1_000)
    } catch {
      // Observability must never change calendar business behavior.
    }
  }

  // ── Push internals ─────────────────────────────────────────────────────

  private async pushTaskToAssigneeCalendars(task: CalendarTaskInput, now: Date): Promise<void> {
    // Eligibility (AC 22): non-null dueDate, not completed/cancelled.
    if (!task.dueDate) return
    if (task.status === 'COMPLETED' || task.status === 'CANCELLED') return

    const connections = await this.prisma.calendarConnection.findMany({
      where: {
        tenantId: task.tenantId,
        userId: task.assignedTo,
        status: 'ACTIVE',
        deletedAt: null,
      },
    })

    for (const connection of connections) {
      // eslint-disable-next-line no-await-in-loop
      await this.pushTaskToConnection(task, connection, now)
    }
  }

  private async pushTaskToConnection(
    task: CalendarTaskInput,
    connection: ConnectionWithTokens,
    now: Date,
  ): Promise<void> {
    const link = await this.prisma.taskCalendarEvent.upsert({
      where: {
        tenantId_taskId_calendarConnectionId: {
          tenantId: task.tenantId,
          taskId: task.id,
          calendarConnectionId: connection.id,
        },
      },
      create: {
        tenantId: task.tenantId,
        taskId: task.id,
        calendarConnectionId: connection.id,
        createdBy: SYSTEM_ACTOR,
        updatedBy: SYSTEM_ACTOR,
      },
      update: {},
    })

    try {
      const accessToken = await this.oauth.getValidAccessToken(connection, now)
      const ctx: CalendarProviderContext = {
        accessToken,
        calendarId: connection.calendarId,
        now,
      }
      const windowStart = task.dueDate as Date
      const windowEnd = new Date(windowStart.getTime() + PUSH_WINDOW_DURATION_MS)

      // Conflict detection (AC 27): overlapping event not our own
      // externalEventId → record it, but the sync still proceeds.
      const busy = await this.providers[connection.provider].listBusy(ctx, windowStart, windowEnd)
      const conflict = findCalendarConflict(busy, windowStart, windowEnd, link.externalEventId)

      const event = mapTaskToCalendarEvent(task)
      let externalEventId = link.externalEventId
      let remoteUpdatedAt: Date | null = null

      if (externalEventId) {
        const res = await this.providers[connection.provider].updateEvent(
          ctx,
          externalEventId,
          event,
        )
        remoteUpdatedAt = res.remoteUpdatedAt
      } else {
        const res = await this.providers[connection.provider].createEvent(ctx, event)
        externalEventId = res.externalEventId
        remoteUpdatedAt = res.remoteUpdatedAt
        // First successful push → MEETING_SCHEDULED producer (AC 28).
        // eslint-disable-next-line no-await-in-loop
        await this.logMeetingScheduled(task, connection, externalEventId)
      }

      await this.prisma.taskCalendarEvent.update({
        where: { id: link.id },
        data: {
          externalEventId,
          syncStatus: 'SYNCED',
          lastError: null,
          attemptCount: 0,
          nextAttemptAt: null,
          remoteUpdatedAt,
          localSyncedAt: now,
          conflictDetectedAt: conflict.conflict ? now : null,
          conflictSummary: conflict.summary,
          updatedBy: SYSTEM_ACTOR,
        },
      })
    } catch (error) {
      // Durable retry ladder (AC 23): FAILED + lastError + attemptCount+1 +
      // nextAttemptAt = now + min(2^attemptCount, 60) minutes. The attempt
      // count used for the backoff is the PREVIOUS value on the row.
      await this.recordPushFailure(link.id, error, now)
    }
  }

  private async recordPushFailure(linkId: string, error: unknown, now: Date): Promise<void> {
    const link = await this.prisma.taskCalendarEvent.findUnique({ where: { id: linkId } })
    if (!link) return
    const backoffMinutes = Math.min(2 ** link.attemptCount, MAX_BACKOFF_MINUTES)
    const nextAttemptAt = new Date(now.getTime() + backoffMinutes * 60 * 1000)
    await this.prisma.taskCalendarEvent.update({
      where: { id: linkId },
      data: {
        syncStatus: 'FAILED',
        lastError: error instanceof Error ? error.message : String(error),
        attemptCount: link.attemptCount + 1,
        nextAttemptAt,
        updatedBy: SYSTEM_ACTOR,
      },
    })
  }

  /**
   * MEETING_SCHEDULED producer (AC 28), on the first successful push of a
   * task that has a Contact. `Activity.contactId` is NOT NULL
   * while `Task.contactId` is nullable — the orphan case skips silently and
   * the sync must still succeed (T3).
   */
  private async logMeetingScheduled(
    task: CalendarTaskInput,
    connection: ConnectionWithTokens,
    externalEventId: string,
  ): Promise<void> {
    try {
      if (
        !(await this.activityLogPreference.isEnabled(
          task.tenantId,
          task.assignedTo,
          'logMeetingScheduled',
        ))
      ) {
        return
      }

      const contactId = task.contactId
      if (!contactId) {
        // Task without a Contact has nowhere to log.
        return
      }

      await this.activity.logSafe({
        tenantId: task.tenantId,
        contactId,
        type: 'MEETING_SCHEDULED',
        title: `Meeting scheduled: ${task.title}`,
        metadata: {
          taskId: task.id,
          provider: connection.provider,
          externalEventId,
          dueDate: task.dueDate ? task.dueDate.toISOString() : null,
        },
        source: 'CALENDAR',
        sourceId: task.id,
        dedupeKey: `MEETING:${task.id}:${connection.id}`,
        createdBy: task.assignedTo,
      })
    } catch (error) {
      this.logger.warn(
        `MEETING_SCHEDULED activity log failed for task ${task.id}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /** Deletes the remote events for every link row of a task, then hard-deletes
   * the link rows (AC 23 complete/delete/assign). Best-effort per connection. */
  private async removeTaskFromCalendar(task: CalendarTaskInput, now: Date): Promise<void> {
    const links = await this.prisma.taskCalendarEvent.findMany({
      where: { tenantId: task.tenantId, taskId: task.id },
      select: { id: true, externalEventId: true, calendarConnectionId: true },
    })
    if (links.length === 0) return

    const connections = await this.prisma.calendarConnection.findMany({
      where: { id: { in: links.map((l) => l.calendarConnectionId) } },
    })
    const connectionById = new Map(connections.map((c) => [c.id, c]))

    for (const link of links) {
      const connection = connectionById.get(link.calendarConnectionId)
      if (!connection || !link.externalEventId) continue
      try {
        const accessToken = await this.oauth.getValidAccessToken(connection, now)
        // eslint-disable-next-line no-await-in-loop
        await this.providers[connection.provider].deleteEvent(
          { accessToken, calendarId: connection.calendarId, now },
          link.externalEventId,
        )
      } catch (error) {
        this.logger.warn(
          `Failed to delete remote event ${link.externalEventId} (connection ${connection.id}): ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }

    await this.prisma.taskCalendarEvent.deleteMany({
      where: { tenantId: task.tenantId, taskId: task.id },
    })
  }

  /**
   * Explicit `syncCalendar(provider)` mutation (AC 26/31): syncs the caller's
   * ACTIVE connection for one provider. Best-effort — never throws.
   */
  async syncProvider(
    tenantId: string,
    userId: string,
    provider: CalendarProvider,
    now: Date = new Date(),
  ): Promise<void> {
    const connection = await this.prisma.calendarConnection.findFirst({
      where: { tenantId, userId, provider, status: 'ACTIVE', deletedAt: null },
    })
    if (!connection) return
    try {
      await this.syncConnection(connection.id, now)
    } catch (error) {
      this.logger.error(
        `Calendar sync failed for connection ${connection.id}`,
        error instanceof Error ? error.stack : String(error),
      )
    }
  }

  // ── Pull internals ─────────────────────────────────────────────────────

  private async applyInboundChanges(
    connection: ConnectionWithTokens,
    changes: CalendarRemoteEvent[],
  ): Promise<void> {
    for (const event of changes) {
      // eslint-disable-next-line no-await-in-loop
      await this.applyInboundChange(connection, event)
    }
  }

  private async applyInboundChange(
    connection: ConnectionWithTokens,
    event: CalendarRemoteEvent,
  ): Promise<void> {
    // Match inbound events to CRM tasks by TaskCalendarEvent.externalEventId
    // ONLY (AC 25). An inbound event with no matching link row is ignored —
    // we never create CRM tasks from arbitrary calendar entries.
    const link = await this.prisma.taskCalendarEvent.findFirst({
      where: {
        calendarConnectionId: connection.id,
        externalEventId: event.externalEventId,
      },
      select: { id: true, taskId: true, remoteUpdatedAt: true, externalEventId: true },
    })
    if (!link) return

    // Cancelled/@removed → hard-delete the link row and leave the task alone
    // (AC 25). Deleting a CRM task because a calendar entry vanished is
    // destructive and out of proportion.
    if (event.cancelled) {
      await this.prisma.taskCalendarEvent.delete({ where: { id: link.id } })
      await this.audit.log({
        tenantId: connection.tenantId,
        userId: connection.userId,
        action: 'DELETE',
        entity: 'TASK',
        entityId: link.taskId,
        details: { mutationName: 'CALENDAR_PULL', change: 'event_cancelled' },
      })
      return
    }

    // Loop guard (AC 24): skip an inbound change whose remoteUpdatedAt is not
    // newer than the stored remoteUpdatedAt.
    if (
      link.remoteUpdatedAt &&
      event.remoteUpdatedAt &&
      event.remoteUpdatedAt.getTime() <= link.remoteUpdatedAt.getTime()
    ) {
      return
    }

    const task = await this.prisma.task.findFirst({
      where: { id: link.taskId, tenantId: connection.tenantId, deletedAt: null },
      select: { id: true, title: true, dueDate: true },
    })
    if (!task) {
      // Task soft-deleted or gone — drop the stale link row.
      await this.prisma.taskCalendarEvent.delete({ where: { id: link.id } })
      return
    }

    const changedFields: string[] = []
    const data: Prisma.TaskUpdateManyMutationInput = { updatedBy: connection.userId }
    if (event.start && event.start.getTime() !== task.dueDate?.getTime()) {
      data.dueDate = event.start
      changedFields.push('dueDate')
    }
    if (event.title !== null && event.title !== task.title) {
      data.title = event.title
      changedFields.push('title')
    }

    if (changedFields.length > 0) {
      await this.prisma.task.updateMany({
        where: { id: task.id, tenantId: connection.tenantId, deletedAt: null },
        data,
      })
      // Every applied change writes an audit row with userId = the connection
      // owner (AC 25, NFR9).
      await this.audit.log({
        tenantId: connection.tenantId,
        userId: connection.userId,
        action: 'UPDATE',
        entity: 'TASK',
        entityId: task.id,
        details: { mutationName: 'CALENDAR_PULL', changedFields },
      })
    }

    await this.prisma.taskCalendarEvent.update({
      where: { id: link.id },
      data: {
        remoteUpdatedAt: event.remoteUpdatedAt,
        updatedBy: SYSTEM_ACTOR,
      },
    })
  }

  private toTaskCalendarSync(link: {
    taskId: string
    syncStatus: string
    lastError: string | null
    externalEventId: string | null
    localSyncedAt: Date | null
    nextAttemptAt: Date | null
    conflictSummary: string | null
    calendarConnection: { provider: CalendarProvider }
  }): TaskCalendarSyncResult {
    return {
      taskId: link.taskId,
      syncStatus: link.syncStatus,
      lastError: link.lastError,
      externalEventId: link.externalEventId,
      lastSyncedAt: link.localSyncedAt ? link.localSyncedAt.toISOString() : null,
      nextAttemptAt: link.nextAttemptAt ? link.nextAttemptAt.toISOString() : null,
      provider: link.calendarConnection.provider,
      conflictSummary: link.conflictSummary,
    }
  }
}
