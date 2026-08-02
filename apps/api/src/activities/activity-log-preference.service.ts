import { Injectable } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import {
  ACTIVITY_LOG_PREFERENCE_KEYS,
  DEFAULT_ACTIVITY_LOG_PREFERENCES,
  type ActivityLogPreferenceKey,
} from './activity-log-preference-keys'

export type ActivityLogPreferenceInput = Partial<Record<ActivityLogPreferenceKey, boolean>>

@Injectable()
export class ActivityLogPreferenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Whether auto-logging for a given event key is enabled. Returns true when
   * `userId` is null (a system event with no acting user — e.g.
   * MESSAGE_RECEIVED on a conversation with no assignee) or when no preference
   * row exists (all-defaults-when-absent, matching UserReminderPreference).
   */
  async isEnabled(
    tenantId: string,
    userId: string | null,
    key: ActivityLogPreferenceKey,
  ): Promise<boolean> {
    if (userId === null) return true

    const row = await this.prisma.userActivityLogPreference.findFirst({
      where: { tenantId, userId, deletedAt: null },
      select: { [key]: true },
    })

    return row === null ? true : row[key]
  }

  /**
   * The caller's preference row, or all-defaults when none exists.
   * Must NOT create a row as a side effect (explicit rule inherited from
   * UserReminderPreference — schema.prisma).
   */
  async findMine(tenantId: string, userId: string): Promise<Record<string, unknown>> {
    const row = await this.prisma.userActivityLogPreference.findFirst({
      where: { tenantId, userId, deletedAt: null },
    })

    if (!row) {
      return { ...DEFAULT_ACTIVITY_LOG_PREFERENCES }
    }

    return row
  }

  /**
   * Upsert the caller's preferences on tenantId_userId. The update branch MUST
   * set `deletedAt: null` — an upsert whose update block omits it silently
   * no-ops against a soft-deleted row (finding 3.7-F2).
   *
   * Writes an audit row via an explicit AuditService.log call (AC 41). The
   * global AuditInterceptor never fires for GraphQL mutations in this repo —
   * the hand-built Pothos schema bypasses the NestJS resolver map (AC 42) —
   * so this service-level write is the only path that produces an AuditLog
   * row. Auto-logged activities themselves are NOT audited here: they are
   * derived records whose originating mutation is already audited (AC 44).
   */
  async updateMine(
    tenantId: string,
    userId: string,
    input: ActivityLogPreferenceInput,
  ): Promise<Record<string, unknown>> {
    const data: Partial<Record<ActivityLogPreferenceKey, boolean>> = {}
    for (const key of ACTIVITY_LOG_PREFERENCE_KEYS) {
      if (input[key] !== undefined) {
        data[key] = input[key]
      }
    }

    const row = await this.prisma.userActivityLogPreference.upsert({
      where: { tenantId_userId: { tenantId, userId } },
      create: {
        tenantId,
        userId,
        ...DEFAULT_ACTIVITY_LOG_PREFERENCES,
        ...data,
        createdBy: userId,
        updatedBy: userId,
      },
      update: {
        ...data,
        updatedBy: userId,
        deletedAt: null,
      },
    })

    await this.audit.log({
      tenantId,
      userId,
      action: 'UPDATE',
      entity: 'USER',
      entityId: userId,
      details: { mutationName: 'UPDATE_ACTIVITY_LOG_PREFERENCES' },
    })

    return row
  }
}
