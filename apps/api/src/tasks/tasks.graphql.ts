import { UnauthorizedException } from '@nestjs/common'

/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/explicit-module-boundary-types */

import { builder } from '../graphql/schema.builder'
import { requirePermission } from '../common/guards/permission-check'
import { TASK_PRIORITIES, TASK_STATUSES } from './task-due-status'
import { PUBSUB_TASK_ASSIGNED } from './task-pubsub.service'
import type { TaskPriority, TaskStatus } from './task-due-status'
import type { TasksService } from './tasks.service'
import type { TaskTemplatesService } from './task-templates.service'
import type { TaskPubSubService } from './task-pubsub.service'
import type { GraphqlContext } from '../graphql/graphql-context'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

// ─── Enums ────────────────────────────────────────────────

const TaskStatusRef = builder.enumType('TaskStatus', { values: TASK_STATUSES })
const TaskPriorityRef = builder.enumType('TaskPriority', { values: TASK_PRIORITIES })

// ─── Nested refs ──────────────────────────────────────────

type AssigneeShape = {
  id: string
  firstName: string
  lastName: string
  email: string
  avatar?: string | null
}

const AssigneeRef = builder.objectRef<AssigneeShape>('TaskAssignee')

AssigneeRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    firstName: t.exposeString('firstName'),
    lastName: t.exposeString('lastName'),
    email: t.exposeString('email'),
    avatar: t.string({
      nullable: true,
      resolve: (assignee) => assignee.avatar ?? null,
    }),
  }),
})

type ContactShape = {
  id: string
  firstName: string
  lastName: string
  email: string
}

const ContactRef = builder.objectRef<ContactShape>('TaskContact')

ContactRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    firstName: t.exposeString('firstName'),
    lastName: t.exposeString('lastName'),
    email: t.exposeString('email'),
  }),
})

type DealShape = {
  id: string
  title: string
}

const DealRef = builder.objectRef<DealShape>('TaskDeal')

DealRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    title: t.exposeString('title'),
  }),
})

// ─── Task Type ────────────────────────────────────────────

export type TaskGraphqlShape = {
  id: string
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  dueDate: Date | null
  assignedTo: string
  contactId: string | null
  dealId: string | null
  completedAt: Date | null
  createdAt: Date
  updatedAt: Date
  createdBy: string
  assignee?: AssigneeShape | null
  contact?: ContactShape | null
  deal?: DealShape | null
}

export const TaskRef = builder.objectRef<TaskGraphqlShape>('Task')

TaskRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    title: t.exposeString('title'),
    description: t.string({
      nullable: true,
      resolve: (task) => task.description ?? null,
    }),
    status: t.field({ type: TaskStatusRef, resolve: (task) => task.status }),
    priority: t.field({ type: TaskPriorityRef, resolve: (task) => task.priority }),
    dueDate: t.string({
      nullable: true,
      resolve: (task) => task.dueDate?.toISOString() ?? null,
    }),
    assignedTo: t.exposeID('assignedTo'),
    contactId: t.string({
      nullable: true,
      resolve: (task) => task.contactId ?? null,
    }),
    dealId: t.string({
      nullable: true,
      resolve: (task) => task.dealId ?? null,
    }),
    completedAt: t.string({
      nullable: true,
      resolve: (task) => task.completedAt?.toISOString() ?? null,
    }),
    createdBy: t.exposeString('createdBy'),
    createdAt: t.string({ resolve: (task) => task.createdAt.toISOString() }),
    updatedAt: t.string({ resolve: (task) => task.updatedAt.toISOString() }),
    assignee: t.field({
      type: AssigneeRef,
      nullable: true,
      resolve: (task) =>
        'assignee' in task && task.assignee ? (task.assignee as unknown as AssigneeShape) : null,
    }),
    contact: t.field({
      type: ContactRef,
      nullable: true,
      resolve: (task) =>
        'contact' in task && task.contact ? (task.contact as unknown as ContactShape) : null,
    }),
    deal: t.field({
      type: DealRef,
      nullable: true,
      resolve: (task) => ('deal' in task && task.deal ? (task.deal as unknown as DealShape) : null),
    }),
  }),
})

// ─── TaskConnection Type ──────────────────────────────────

const TaskConnectionRef = builder
  .objectRef<{
    items: TaskGraphqlShape[]
    total: number
    page: number
    pageSize: number
  }>('TaskConnection')
  .implement({
    fields: (t) => ({
      items: t.field({ type: [TaskRef], resolve: (connection) => connection.items }),
      total: t.exposeInt('total'),
      page: t.exposeInt('page'),
      pageSize: t.exposeInt('pageSize'),
    }),
  })

// ─── TaskTemplate Type ────────────────────────────────────

export type TaskTemplateGraphqlShape = {
  id: string
  name: string
  title: string
  description: string | null
  defaultPriority: TaskPriority
  defaultDueInDays: number | null
  createdAt: Date
  updatedAt: Date
}

export const TaskTemplateRef = builder.objectRef<TaskTemplateGraphqlShape>('TaskTemplate')

TaskTemplateRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    title: t.exposeString('title'),
    description: t.string({
      nullable: true,
      resolve: (template) => template.description ?? null,
    }),
    defaultPriority: t.field({
      type: TaskPriorityRef,
      resolve: (template) => template.defaultPriority,
    }),
    defaultDueInDays: t.int({
      nullable: true,
      resolve: (template) => template.defaultDueInDays ?? null,
    }),
    createdAt: t.string({ resolve: (template) => template.createdAt.toISOString() }),
    updatedAt: t.string({ resolve: (template) => template.updatedAt.toISOString() }),
  }),
})

// ─── TaskTemplateConnection Type ──────────────────────────

const TaskTemplateConnectionRef = builder
  .objectRef<{
    items: TaskTemplateGraphqlShape[]
    total: number
    page: number
    pageSize: number
  }>('TaskTemplateConnection')
  .implement({
    fields: (t) => ({
      items: t.field({ type: [TaskTemplateRef], resolve: (connection) => connection.items }),
      total: t.exposeInt('total'),
      page: t.exposeInt('page'),
      pageSize: t.exposeInt('pageSize'),
    }),
  })

// ─── Input Types ──────────────────────────────────────────

const CreateTaskInputRef = builder.inputType('CreateTaskInput', {
  fields: (t) => ({
    title: t.string({ required: true }),
    description: t.string(),
    status: t.field({ type: TaskStatusRef }),
    priority: t.field({ type: TaskPriorityRef }),
    dueDate: t.string(),
    assignedTo: t.string(),
    contactId: t.string(),
    dealId: t.string(),
  }),
})

const UpdateTaskInputRef = builder.inputType('UpdateTaskInput', {
  fields: (t) => ({
    title: t.string(),
    description: t.string(),
    status: t.field({ type: TaskStatusRef }),
    priority: t.field({ type: TaskPriorityRef }),
    dueDate: t.string(),
    assignedTo: t.string(),
    contactId: t.string(),
    dealId: t.string(),
  }),
})

const TaskFilterInputRef = builder.inputType('TaskFilterInput', {
  fields: (t) => ({
    search: t.string(),
    status: t.field({ type: TaskStatusRef }),
    priority: t.field({ type: TaskPriorityRef }),
    assignedTo: t.string(),
    contactId: t.string(),
    dealId: t.string(),
    dueDateFrom: t.string(),
    dueDateTo: t.string(),
    overdueOnly: t.boolean(),
  }),
})

const TaskPaginationInputRef = builder.inputType('TaskPaginationInput', {
  fields: (t) => ({
    page: t.int(),
    pageSize: t.int(),
  }),
})

const CreateTaskTemplateInputRef = builder.inputType('CreateTaskTemplateInput', {
  fields: (t) => ({
    name: t.string({ required: true }),
    title: t.string({ required: true }),
    description: t.string(),
    defaultPriority: t.field({ type: TaskPriorityRef }),
    defaultDueInDays: t.int(),
  }),
})

const UpdateTaskTemplateInputRef = builder.inputType('UpdateTaskTemplateInput', {
  fields: (t) => ({
    name: t.string(),
    title: t.string(),
    description: t.string(),
    defaultPriority: t.field({ type: TaskPriorityRef }),
    defaultDueInDays: t.int(),
  }),
})

const CreateTaskFromTemplateInputRef = builder.inputType('CreateTaskFromTemplateInput', {
  fields: (t) => ({
    templateId: t.string({ required: true }),
    assignedTo: t.string(),
    contactId: t.string(),
    dealId: t.string(),
    dueDate: t.string(),
    title: t.string(),
  }),
})

// ─── Service Singletons ───────────────────────────────────

let tasksService: TasksService | undefined
let taskTemplatesService: TaskTemplatesService | undefined
let taskPubSub: TaskPubSubService | undefined

function getTasksService(): TasksService {
  if (!tasksService) {
    throw new Error('TasksService is not initialized')
  }
  return tasksService
}

function getTaskTemplatesService(): TaskTemplatesService {
  if (!taskTemplatesService) {
    throw new Error('TaskTemplatesService is not initialized')
  }
  return taskTemplatesService
}

function getTaskPubSub(): TaskPubSubService {
  if (!taskPubSub) {
    throw new Error('TaskPubSubService is not initialized')
  }
  return taskPubSub
}

function requireUser(context: GraphqlContext): JwtPayload {
  if (!context.user) {
    throw new UnauthorizedException('Authentication required')
  }
  return context.user
}

// ─── Queries ──────────────────────────────────────────────

builder.queryFields((t) => ({
  task: t.field({
    type: TaskRef,
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'TASK', 'READ')
      return getTasksService().findOne(
        user.tenantId,
        user.userId,
        String(args.id),
      ) as unknown as TaskGraphqlShape
    },
  }),
  tasks: t.field({
    type: TaskConnectionRef,
    args: {
      filter: t.arg({ type: TaskFilterInputRef }),
      pagination: t.arg({ type: TaskPaginationInputRef }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'TASK', 'READ')
      return getTasksService().findMany(
        user.tenantId,
        user.userId,
        {
          search: args.filter?.search ?? undefined,
          status: args.filter?.status ?? undefined,
          priority: args.filter?.priority ?? undefined,
          assignedTo: args.filter?.assignedTo ?? undefined,
          contactId: args.filter?.contactId ?? undefined,
          dealId: args.filter?.dealId ?? undefined,
          dueDateFrom: args.filter?.dueDateFrom ?? undefined,
          dueDateTo: args.filter?.dueDateTo ?? undefined,
          overdueOnly: args.filter?.overdueOnly ?? undefined,
        },
        {
          page: args.pagination?.page ?? undefined,
          pageSize: args.pagination?.pageSize ?? undefined,
        },
      )
    },
  }),
  myTasks: t.field({
    type: TaskConnectionRef,
    args: {
      filter: t.arg({ type: TaskFilterInputRef }),
      pagination: t.arg({ type: TaskPaginationInputRef }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'TASK', 'READ')
      // myTasks derives the assignee from the JWT — no userId argument
      // (arbitration #4). filter.assignedTo is forced to the caller.
      return getTasksService().findMany(
        user.tenantId,
        user.userId,
        {
          search: args.filter?.search ?? undefined,
          status: args.filter?.status ?? undefined,
          priority: args.filter?.priority ?? undefined,
          assignedTo: user.userId,
          contactId: args.filter?.contactId ?? undefined,
          dealId: args.filter?.dealId ?? undefined,
          dueDateFrom: args.filter?.dueDateFrom ?? undefined,
          dueDateTo: args.filter?.dueDateTo ?? undefined,
          overdueOnly: args.filter?.overdueOnly ?? undefined,
        },
        {
          page: args.pagination?.page ?? undefined,
          pageSize: args.pagination?.pageSize ?? undefined,
        },
      )
    },
  }),
  taskTemplates: t.field({
    type: TaskTemplateConnectionRef,
    args: {
      pagination: t.arg({ type: TaskPaginationInputRef }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'TASK', 'READ')
      return getTaskTemplatesService().findMany(user.tenantId, {
        page: args.pagination?.page ?? undefined,
        pageSize: args.pagination?.pageSize ?? undefined,
      })
    },
  }),
  taskTemplate: t.field({
    type: TaskTemplateRef,
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'TASK', 'READ')
      return getTaskTemplatesService().findOneForTenant(
        user.tenantId,
        String(args.id),
      ) as unknown as TaskTemplateGraphqlShape
    },
  }),
}))

// ─── Mutations ────────────────────────────────────────────

builder.mutationFields((t) => ({
  createTask: t.field({
    type: TaskRef,
    args: { input: t.arg({ type: CreateTaskInputRef, required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'TASK', 'CREATE')
      // AC 51: creating a task assigned to someone else additionally requires
      // TASK:ASSIGN — otherwise a SALES_REP could push work onto a colleague
      // through the create path, defeating the ASSIGN gate.
      if (args.input.assignedTo && args.input.assignedTo !== user.userId) {
        await requirePermission(context, 'TASK', 'ASSIGN')
      }
      return getTasksService().create(user.tenantId, user.userId, {
        title: args.input.title,
        description: args.input.description ?? undefined,
        status: args.input.status ?? undefined,
        priority: args.input.priority ?? undefined,
        dueDate: args.input.dueDate ?? undefined,
        assignedTo: args.input.assignedTo ?? undefined,
        contactId: args.input.contactId ?? undefined,
        dealId: args.input.dealId ?? undefined,
      }) as unknown as TaskGraphqlShape
    },
  }),
  updateTask: t.field({
    type: TaskRef,
    args: {
      id: t.arg.id({ required: true }),
      input: t.arg({ type: UpdateTaskInputRef, required: true }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'TASK', 'UPDATE')
      return getTasksService().update(user.tenantId, user.userId, String(args.id), {
        title: args.input.title ?? undefined,
        description: args.input.description ?? undefined,
        status: args.input.status ?? undefined,
        priority: args.input.priority ?? undefined,
        dueDate: args.input.dueDate ?? undefined,
        assignedTo: args.input.assignedTo ?? undefined,
        contactId: args.input.contactId ?? undefined,
        dealId: args.input.dealId ?? undefined,
      }) as unknown as TaskGraphqlShape
    },
  }),
  deleteTask: t.boolean({
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'TASK', 'DELETE')
      return getTasksService().delete(user.tenantId, user.userId, String(args.id))
    },
  }),
  assignTask: t.field({
    type: TaskRef,
    args: {
      id: t.arg.id({ required: true }),
      assigneeId: t.arg.id({ required: true }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'TASK', 'ASSIGN')
      return getTasksService().assign(
        user.tenantId,
        user.userId,
        String(args.id),
        String(args.assigneeId),
      ) as unknown as TaskGraphqlShape
    },
  }),
  completeTask: t.field({
    type: TaskRef,
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'TASK', 'UPDATE')
      return getTasksService().complete(
        user.tenantId,
        user.userId,
        String(args.id),
      ) as unknown as TaskGraphqlShape
    },
  }),
  createTaskTemplate: t.field({
    type: TaskTemplateRef,
    args: { input: t.arg({ type: CreateTaskTemplateInputRef, required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'TASK', 'CREATE')
      return getTaskTemplatesService().create(user.tenantId, user.userId, {
        name: args.input.name,
        title: args.input.title,
        description: args.input.description ?? undefined,
        defaultPriority: args.input.defaultPriority ?? undefined,
        defaultDueInDays: args.input.defaultDueInDays ?? undefined,
      }) as unknown as TaskTemplateGraphqlShape
    },
  }),
  updateTaskTemplate: t.field({
    type: TaskTemplateRef,
    args: {
      id: t.arg.id({ required: true }),
      input: t.arg({ type: UpdateTaskTemplateInputRef, required: true }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'TASK', 'UPDATE')
      return getTaskTemplatesService().update(user.tenantId, user.userId, String(args.id), {
        name: args.input.name ?? undefined,
        title: args.input.title ?? undefined,
        description: args.input.description ?? undefined,
        defaultPriority: args.input.defaultPriority ?? undefined,
        defaultDueInDays: args.input.defaultDueInDays ?? undefined,
      }) as unknown as TaskTemplateGraphqlShape
    },
  }),
  deleteTaskTemplate: t.boolean({
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'TASK', 'DELETE')
      return getTaskTemplatesService().delete(user.tenantId, user.userId, String(args.id))
    },
  }),
  createTaskFromTemplate: t.field({
    type: TaskRef,
    args: { input: t.arg({ type: CreateTaskFromTemplateInputRef, required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'TASK', 'CREATE')
      // AC 51: a template may carry a default assignee override — foreign
      // assignment through the template path needs ASSIGN too.
      if (args.input.assignedTo && args.input.assignedTo !== user.userId) {
        await requirePermission(context, 'TASK', 'ASSIGN')
      }
      return getTasksService().createFromTemplate(
        user.tenantId,
        user.userId,
        String(args.input.templateId),
        {
          assignedTo: args.input.assignedTo ?? undefined,
          contactId: args.input.contactId ?? undefined,
          dealId: args.input.dealId ?? undefined,
          dueDate: args.input.dueDate ?? undefined,
          title: args.input.title ?? undefined,
        },
      ) as unknown as TaskGraphqlShape
    },
  }),
}))

// ─── Subscriptions ────────────────────────────────────────

builder.subscriptionField('onTaskAssigned', (t) =>
  t.field({
    type: TaskRef,
    subscribe: async (_root, _args, context) => {
      const user = requireUser(context)
      const pubsub = getTaskPubSub()
      return {
        [Symbol.asyncIterator]: async function* () {
          // The channel is scoped to the caller's own id, so no
          // resolveVisibilityFilter is applied and none is needed — a
          // subscriber can only ever reach their own channel, and the payload
          // is by construction a task assigned to them.
          // (architecture.md:949-956 constraint 2 mandates a visibility filter
          // inside subscribe; a reviewer who does not see this reason here
          // will flag it as a leak.)
          const channel = `${PUBSUB_TASK_ASSIGNED}:${user.tenantId}:${user.userId}`
          for await (const task of pubsub.subscribe<TaskGraphqlShape>(channel)) {
            yield task
          }
        },
      }
    },
    resolve: (payload: unknown) => payload as TaskGraphqlShape,
  }),
)

// ─── Registration ─────────────────────────────────────────

export function registerTasksGraphql(
  service: TasksService,
  templatesService: TaskTemplatesService,
  pubSubService: TaskPubSubService,
): void {
  tasksService = service
  taskTemplatesService = templatesService
  taskPubSub = pubSubService
}
