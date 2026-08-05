import { UnauthorizedException } from '@nestjs/common'

/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/explicit-module-boundary-types */

import { builder } from '../graphql/schema.builder'
import { requirePermission } from '../common/guards/permission-check'
import type { TimeEntriesService, TimeEntryConnection, TimeEntryItem } from './time-entries.service'
import type { GraphqlContext } from '../graphql/graphql-context'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

// ─── Object Types ─────────────────────────────────────────

// Hand-written objectRef for the nested task slice — there is no
// @pothos/plugin-prisma (AC 25).
const TimeEntryTaskRef = builder.objectRef<{ id: string; title: string }>('TimeEntryTask')

TimeEntryTaskRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    title: t.exposeString('title'),
  }),
})

const TimeEntryRef = builder.objectRef<TimeEntryItem>('TimeEntry')

TimeEntryRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    taskId: t.exposeID('taskId'),
    userId: t.exposeID('userId'),
    // Dates cross GraphQL as ISO strings via t.string({ resolve }) — no Date
    // scalar (AC 30).
    startTime: t.string({ resolve: (entry) => entry.startTime.toISOString() }),
    endTime: t.string({ nullable: true, resolve: (entry) => entry.endTime?.toISOString() ?? null }),
    durationSeconds: t.exposeInt('durationSeconds'),
    description: t.string({ nullable: true, resolve: (entry) => entry.description ?? null }),
    createdAt: t.string({ resolve: (entry) => entry.createdAt.toISOString() }),
    updatedAt: t.string({ resolve: (entry) => entry.updatedAt.toISOString() }),
    task: t.field({ type: TimeEntryTaskRef, resolve: (entry) => entry.task }),
  }),
})

const TimeEntryConnectionRef = builder
  .objectRef<TimeEntryConnection>('TimeEntryConnection')
  .implement({
    fields: (t) => ({
      items: t.field({ type: [TimeEntryRef], resolve: (connection) => connection.items }),
      total: t.exposeInt('total'),
      page: t.exposeInt('page'),
      pageSize: t.exposeInt('pageSize'),
    }),
  })

// ─── Input Types ──────────────────────────────────────────

const CreateTimeEntryInputRef = builder.inputType('CreateTimeEntryInput', {
  fields: (t) => ({
    taskId: t.string({ required: true }),
    durationSeconds: t.int({ required: true }),
    description: t.string(),
    startTime: t.string(),
  }),
})

const UpdateTimeEntryInputRef = builder.inputType('UpdateTimeEntryInput', {
  fields: (t) => ({
    durationSeconds: t.int(),
    description: t.string(),
    startTime: t.string(),
  }),
})

const TimeEntryFilterInputRef = builder.inputType('TimeEntryFilterInput', {
  fields: (t) => ({
    taskId: t.string(),
    userId: t.string(),
    startFrom: t.string(),
    startTo: t.string(),
    runningOnly: t.boolean(),
  }),
})

const TimeEntryPaginationInputRef = builder.inputType('TimeEntryPaginationInput', {
  fields: (t) => ({
    page: t.int(),
    pageSize: t.int(),
  }),
})

// ─── Service Singleton ─────────────────────────────────────

let timeEntriesService: TimeEntriesService | undefined

function getTimeEntriesService(): TimeEntriesService {
  if (!timeEntriesService) {
    throw new Error('TimeEntriesService is not initialized')
  }
  return timeEntriesService
}

function requireUser(context: GraphqlContext): JwtPayload {
  if (!context.user) {
    throw new UnauthorizedException('Authentication required')
  }
  return context.user
}

// ─── Queries ──────────────────────────────────────────────

builder.queryFields((t) => ({
  timeEntries: t.field({
    type: TimeEntryConnectionRef,
    args: {
      filter: t.arg({ type: TimeEntryFilterInputRef }),
      pagination: t.arg({ type: TimeEntryPaginationInputRef }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'TASK', 'READ')
      return getTimeEntriesService().findMany(
        user.tenantId,
        user.userId,
        {
          taskId: args.filter?.taskId ?? undefined,
          userId: args.filter?.userId ?? undefined,
          startFrom: args.filter?.startFrom ?? undefined,
          startTo: args.filter?.startTo ?? undefined,
          runningOnly: args.filter?.runningOnly ?? undefined,
        },
        {
          page: args.pagination?.page ?? undefined,
          pageSize: args.pagination?.pageSize ?? undefined,
        },
      )
    },
  }),
  activeTimeEntry: t.field({
    type: TimeEntryRef,
    nullable: true,
    resolve: async (_parent, _args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'TASK', 'READ')
      return getTimeEntriesService().findActive(user.tenantId, user.userId)
    },
  }),
}))

// ─── Mutations ────────────────────────────────────────────

builder.mutationFields((t) => ({
  startTimer: t.field({
    type: TimeEntryRef,
    args: { taskId: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'TASK', 'UPDATE')
      return getTimeEntriesService().startTimer(user.tenantId, user.userId, args.taskId)
    },
  }),
  stopTimer: t.field({
    type: TimeEntryRef,
    args: { timeEntryId: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'TASK', 'UPDATE')
      return getTimeEntriesService().stopTimer(user.tenantId, user.userId, args.timeEntryId)
    },
  }),
  createTimeEntry: t.field({
    type: TimeEntryRef,
    args: {
      input: t.arg({ type: CreateTimeEntryInputRef, required: true }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'TASK', 'UPDATE')
      return getTimeEntriesService().createTimeEntry(user.tenantId, user.userId, {
        taskId: args.input.taskId,
        durationSeconds: args.input.durationSeconds,
        // Preserve null (clear) vs undefined (omit) — `?? undefined` would
        // collapse null onto undefined and make descriptions un-clearable.
        description: args.input.description !== undefined ? args.input.description : undefined,
        startTime: args.input.startTime ?? undefined,
      })
    },
  }),
  updateTimeEntry: t.field({
    type: TimeEntryRef,
    args: {
      id: t.arg.id({ required: true }),
      input: t.arg({ type: UpdateTimeEntryInputRef, required: true }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'TASK', 'UPDATE')
      return getTimeEntriesService().updateTimeEntry(user.tenantId, user.userId, args.id, {
        durationSeconds: args.input.durationSeconds ?? undefined,
        description: args.input.description !== undefined ? args.input.description : undefined,
        startTime: args.input.startTime ?? undefined,
      })
    },
  }),
  deleteTimeEntry: t.field({
    type: 'Boolean',
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'TASK', 'UPDATE')
      return getTimeEntriesService().deleteTimeEntry(user.tenantId, user.userId, args.id)
    },
  }),
}))

// ─── Registration ─────────────────────────────────────────

export function registerTimeTrackingGraphql(service: TimeEntriesService): void {
  timeEntriesService = service
}
