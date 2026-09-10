import { Logger, UnauthorizedException } from '@nestjs/common'

/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/explicit-module-boundary-types */

// This file MUST be imported from graphql/schema.ts (the barrel). A *.graphql
// module missing from that list silently drops its fields from the SDL with
// no error (AC 30 — T2).
import { builder } from '../graphql/schema.builder'
import type { GraphqlContext } from '../graphql/graphql-context'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'
import type { TasksService } from '../tasks/tasks.service'
import type { CalendarConnectionsService } from './calendar-connections.service'
import type { CalendarOAuthService } from './calendar-oauth.service'
import type { CalendarSyncService } from './calendar-sync.service'

const logger = new Logger('CalendarGraphql')

// ──────────────────────────────────────────────
// Enums
// ──────────────────────────────────────────────

const CALENDAR_PROVIDER_VALUES = ['GOOGLE', 'OUTLOOK'] as const

const CalendarProviderRef = builder.enumType('CalendarProvider', {
  values: CALENDAR_PROVIDER_VALUES,
})

// ──────────────────────────────────────────────
// Object Types
// ──────────────────────────────────────────────

// AC 33: CalendarConnectionRef exposes id, provider, externalAccountEmail,
// calendarId, status, lastSyncedAt, lastSyncError, createdAt — NEVER tokens,
// syncToken or externalAccountId (AC 5). The service `select` covers every
// field below (AC 34).
const CalendarConnectionRef = builder.objectRef<{
  id: string
  provider: 'GOOGLE' | 'OUTLOOK'
  externalAccountEmail: string | null
  calendarId: string
  status: string
  lastSyncedAt: Date | null
  lastSyncError: string | null
  createdAt: Date
}>('CalendarConnection')

CalendarConnectionRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    provider: t.field({ type: CalendarProviderRef, resolve: (conn) => conn.provider }),
    externalAccountEmail: t.exposeString('externalAccountEmail', { nullable: true }),
    calendarId: t.exposeString('calendarId'),
    status: t.exposeString('status'),
    lastSyncedAt: t.string({
      nullable: true,
      resolve: (conn) => conn.lastSyncedAt?.toISOString() ?? null,
    }),
    lastSyncError: t.exposeString('lastSyncError', { nullable: true }),
    createdAt: t.string({ resolve: (conn) => conn.createdAt.toISOString() }),
  }),
})

const CalendarAuthUrlRef = builder.objectRef<{ url: string; state: string }>('CalendarAuthUrl')

CalendarAuthUrlRef.implement({
  fields: (t) => ({
    url: t.exposeString('url'),
    state: t.exposeString('state'),
  }),
})

const TaskCalendarSyncRef = builder.objectRef<{
  taskId: string
  syncStatus: string
  lastError: string | null
  externalEventId: string | null
  lastSyncedAt: string | null
  nextAttemptAt: string | null
  provider: string | null
  conflictSummary: string | null
}>('TaskCalendarSync')

TaskCalendarSyncRef.implement({
  fields: (t) => ({
    taskId: t.exposeID('taskId'),
    syncStatus: t.exposeString('syncStatus'),
    lastError: t.exposeString('lastError', { nullable: true }),
    externalEventId: t.exposeString('externalEventId', { nullable: true }),
    lastSyncedAt: t.exposeString('lastSyncedAt', { nullable: true }),
    nextAttemptAt: t.exposeString('nextAttemptAt', { nullable: true }),
    provider: t.exposeString('provider', { nullable: true }),
    conflictSummary: t.exposeString('conflictSummary', { nullable: true }),
  }),
})

// ──────────────────────────────────────────────
// Input Types
// ──────────────────────────────────────────────

const ConnectCalendarInputRef = builder.inputType('ConnectCalendarInput', {
  fields: (t) => ({
    provider: t.field({ type: CalendarProviderRef, required: true }),
    authCode: t.string({ required: true }),
    state: t.string({ required: true }),
  }),
})

// ──────────────────────────────────────────────
// Module-Level State
// ──────────────────────────────────────────────

let connectionsService: CalendarConnectionsService | undefined
let oauthService: CalendarOAuthService | undefined
let syncService: CalendarSyncService | undefined
let tasksService: TasksService | undefined

export function registerCalendarGraphql(
  connections: CalendarConnectionsService,
  oauth: CalendarOAuthService,
  sync: CalendarSyncService,
): void {
  connectionsService = connections
  oauthService = oauth
  syncService = sync
}

/** TasksService is registered by CalendarTaskBindingModule — the calendar
 * module must NOT import TasksModule (TasksModule already imports
 * CalendarModule; importing back would be a circular module dependency).
 * See channel-dispatcher-binding.module.ts for the precedent. */
export function registerTasksService(service: TasksService): void {
  tasksService = service
}

function getCalendarConnectionsService(): CalendarConnectionsService {
  if (!connectionsService) throw new Error('CalendarConnectionsService not initialized')
  return connectionsService
}

function getCalendarOAuthService(): CalendarOAuthService {
  if (!oauthService) throw new Error('CalendarOAuthService not initialized')
  return oauthService
}

function getCalendarSyncService(): CalendarSyncService {
  if (!syncService) throw new Error('CalendarSyncService not initialized')
  return syncService
}

function getTasksService(): TasksService {
  if (!tasksService) throw new Error('TasksService not initialized')
  return tasksService
}

function requireUser(context: GraphqlContext): JwtPayload {
  if (!context.user) {
    throw new UnauthorizedException('Authentication required')
  }
  return context.user
}

// ──────────────────────────────────────────────
// Queries
// ──────────────────────────────────────────────

builder.queryFields((t) => ({
  // AC 3/26/31: caller's own connections only; lazily fires the throttled
  // 15-minute sweep (fire-and-forget — never awaited, never 500s).
  calendarConnections: t.field({
    type: [CalendarConnectionRef],
    resolve: async (_parent, _args, context) => {
      const user = requireUser(context)
      const connections = await getCalendarConnectionsService().listMine(user.tenantId, user.userId)
      void getCalendarSyncService()
        .syncMine(user.tenantId, user.userId)
        .catch((err) => logger.error('Lazy calendar sweep failed', err))
      return connections
    },
  }),
  calendarAuthUrl: t.field({
    type: CalendarAuthUrlRef,
    args: { provider: t.arg({ type: CalendarProviderRef, required: true }) },
    resolve: (_parent, args, context) => {
      const user = requireUser(context)
      return getCalendarOAuthService().buildAuthorizeUrl(args.provider, user.userId, user.tenantId)
    },
  }),
  // AC 35: NOT a field on TaskRef — a separate query, so taskListSelect is
  // not widened and no N+1 is paid on every task-list query.
  taskCalendarSync: t.field({
    type: TaskCalendarSyncRef,
    nullable: true,
    args: { taskId: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      // AC 32: resolve the task through TasksService.findOne so the caller's
      // normal task visibility applies — never a bare prisma findFirst on a
      // client-supplied id.
      await getTasksService().findOne(user.tenantId, user.userId, args.taskId)
      return getCalendarSyncService().taskCalendarSync(user.tenantId, args.taskId)
    },
  }),
}))

// ──────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────

builder.mutationFields((t) => ({
  connectCalendar: t.field({
    type: CalendarConnectionRef,
    args: { input: t.arg({ type: ConnectCalendarInputRef, required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      return getCalendarConnectionsService().connectCalendar(user.tenantId, user.userId, {
        provider: args.input.provider,
        authCode: args.input.authCode,
        state: args.input.state,
      })
    },
  }),
  disconnectCalendar: t.field({
    type: 'Boolean',
    args: { provider: t.arg({ type: CalendarProviderRef, required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      return getCalendarConnectionsService().disconnectCalendar(
        user.tenantId,
        user.userId,
        args.provider,
      )
    },
  }),
  syncTaskToCalendar: t.field({
    type: TaskCalendarSyncRef,
    args: { taskId: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      // AC 32: resolve the task through TasksService.findOne (visibility).
      const task = await getTasksService().findOne(user.tenantId, user.userId, args.taskId)
      return getCalendarSyncService().syncTaskToCalendar(task)
    },
  }),
  syncCalendar: t.field({
    type: 'Boolean',
    args: { provider: t.arg({ type: CalendarProviderRef, required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await getCalendarSyncService().syncProvider(user.tenantId, user.userId, args.provider)
      return true
    },
  }),
}))
