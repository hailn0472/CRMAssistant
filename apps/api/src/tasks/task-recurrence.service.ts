import { Injectable, Logger } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'
import { TaskPubSubService, PUBSUB_TASK_CHANGED } from './task-pubsub.service'
import { computeDueOccurrences } from './task-recurrence'
import { toUtcMidnight } from './task-due-status'
import type { RecurrencePattern } from '@prisma/client'

const MAX_RECURRENCE_TEMPLATES_PER_RUN = 200
const MAX_OCCURRENCES_PER_TEMPLATE_PER_RUN = 30

@Injectable()
export class TaskRecurrenceService {
  private readonly logger = new Logger(TaskRecurrenceService.name)
  private lastSweepDate: string | null = null

  constructor(
    private readonly prisma: PrismaService,
    private readonly taskPubSub: TaskPubSubService,
  ) {}

  /**
   * Story 4.6 (AC 30): run recurring task generation for all templates in
   * the tenant. Tenant-wide — no visibility filter, no buildTaskWhere.
   *
   * Returns { generated, templatesScanned } for the ADMIN mutation result.
   */
  async runRecurringTaskGeneration(
    tenantId: string,
    actingUserId: string,
    now: Date,
  ): Promise<{ generated: number; templatesScanned: number }> {
    // AC 30b: fetch templates with parentTaskId = null (occurrences don't generate)
    const templates = await this.prisma.task.findMany({
      where: {
        tenantId,
        deletedAt: null,
        isRecurring: true,
        parentTaskId: null,
      },
      select: {
        id: true,
        tenantId: true,
        title: true,
        description: true,
        priority: true,
        dueDate: true,
        assignedTo: true,
        contactId: true,
        dealId: true,
        recurrencePattern: true,
        recurrenceEndDate: true,
      },
      take: MAX_RECURRENCE_TEMPLATES_PER_RUN + 1,
      orderBy: { createdAt: 'asc' },
    })

    const templatesOverflow = templates.length > MAX_RECURRENCE_TEMPLATES_PER_RUN
    const templatesToProcess = templatesOverflow
      ? templates.slice(0, MAX_RECURRENCE_TEMPLATES_PER_RUN)
      : templates

    if (templatesOverflow) {
      this.logger.warn(
        `Recurrence sweep: ${templates.length} templates exceed cap of ${MAX_RECURRENCE_TEMPLATES_PER_RUN}, processing first ${MAX_RECURRENCE_TEMPLATES_PER_RUN}`,
      )
    }

    let generated = 0
    let templatesScanned = 0

    for (const template of templatesToProcess) {
      templatesScanned++

      if (!template.dueDate) {
        // AC 30d: template with no dueDate generates nothing
        this.logger.warn(`Template ${template.id} has no dueDate — skipping recurrence generation`)
        continue
      }

      if (!template.recurrencePattern) {
        this.logger.warn(`Template ${template.id} is isRecurring but has no pattern — skipping`)
        continue
      }

      // AC 30d: anchor = MAX(dueDate) across existing occurrences, else template's dueDate
      const maxOccurrenceDate = await this.prisma.task.findFirst({
        where: {
          tenantId,
          parentTaskId: template.id,
        },
        select: { dueDate: true },
        orderBy: { dueDate: 'desc' },
        take: 1,
      })

      const anchor = maxOccurrenceDate?.dueDate ?? template.dueDate

      // AC 30e: generate while next <= toUtcMidnight(now), capped at 30
      const occurrences = computeDueOccurrences(
        anchor,
        template.recurrencePattern as RecurrencePattern,
        template.recurrenceEndDate,
        now,
        MAX_OCCURRENCES_PER_TEMPLATE_PER_RUN,
      )

      for (const dueDate of occurrences) {
        try {
          // AC 30h: idempotency check + insert in Serializable transaction
          await this.prisma.$transaction(
            async (tx) => {
              // Check if occurrence already exists (including soft-deleted)
              const existing = await tx.task.findFirst({
                where: {
                  tenantId,
                  parentTaskId: template.id,
                  dueDate,
                },
                select: { id: true },
              })

              if (existing) {
                // Already exists — skip (AC 30h)
                return
              }

              // Create the occurrence (AC 30f)
              const newTask = await tx.task.create({
                data: {
                  tenantId,
                  title: template.title,
                  description: template.description,
                  priority: template.priority,
                  assignedTo: template.assignedTo,
                  contactId: template.contactId,
                  dealId: template.dealId,
                  dueDate,
                  status: 'TODO',
                  completedAt: null,
                  isRecurring: false,
                  recurrencePattern: null,
                  recurrenceEndDate: null,
                  parentTaskId: template.id,
                  createdBy: actingUserId,
                  updatedBy: actingUserId,
                },
                select: { id: true },
              })

              // AC 30i: audit row per generated occurrence
              await tx.auditLog.create({
                data: {
                  tenantId,
                  userId: actingUserId,
                  action: 'CREATE',
                  entity: 'TASK',
                  entityId: newTask.id,
                  details: {
                    mutationName: 'runRecurringTaskGeneration',
                    parentTaskId: template.id,
                  },
                },
              })

              // AC 30j: publish TASK_CHANGED per occurrence
              try {
                this.taskPubSub.publish(`${PUBSUB_TASK_CHANGED}:${tenantId}`, {
                  id: newTask.id,
                  tenantId,
                })
              } catch {
                // Publishing never fails the sweep
              }

              generated++
            },
            {
              isolationLevel: 'Serializable' as never,
            },
          )
        } catch (error: unknown) {
          // AC 30h: P2034 → skip-and-log (sweep must not fail)
          if (error && typeof error === 'object' && 'code' in error && error.code === 'P2034') {
            this.logger.warn(
              `Serializable conflict generating occurrence for template ${template.id} on ${dueDate.toISOString()} — skipping`,
            )
            continue
          }
          throw error
        }
      }
    }

    return { generated, templatesScanned }
  }

  /**
   * Story 4.6 (AC 32): lazy entry point. Never throws — the whole body is
   * wrapped in try/catch. Modelled on deal-health.service.ts:461-479.
   */
  async ensureRecurrenceGeneratedToday(tenantId: string, userId: string, now: Date): Promise<void> {
    try {
      const todayKey = toUtcMidnight(now).toISOString()
      if (this.lastSweepDate === todayKey) return

      await this.runRecurringTaskGeneration(tenantId, userId, now)
      this.lastSweepDate = todayKey
    } catch (error) {
      // AC 32: failures are caught and logged — the at-risk query must never 500
      this.logger.error('Lazy recurrence sweep failed', error)
    }
  }
}
