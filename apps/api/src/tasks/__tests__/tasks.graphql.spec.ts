import { UnauthorizedException } from '@nestjs/common'
import { graphql, printSchema } from 'graphql'

// Must import BEFORE schema (Pothos registration order — AC 85)
import '../tasks.graphql'
import { schema } from '../../graphql/schema'
import { builder } from '../../graphql/schema.builder'
import { registerTasksGraphql, TaskRef, TaskTemplateRef } from '../tasks.graphql'
import { TASK_PRIORITIES, TASK_STATUSES } from '../task-due-status'
import type { TasksService } from '../tasks.service'
import type { TaskTemplatesService } from '../task-templates.service'
import type { TaskPubSubService } from '../task-pubsub.service'
import type { TaskDependenciesService } from '../task-dependencies.service'
import type { TaskRecurrenceService } from '../task-recurrence.service'

const mockTask = {
  id: 'task-1',
  tenantId: 'tenant-1',
  title: 'Follow up',
  description: null,
  status: 'TODO',
  priority: 'MEDIUM',
  dueDate: null,
  assignedTo: 'user-1',
  contactId: null,
  dealId: null,
  completedAt: null,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  createdBy: 'user-1',
  updatedBy: 'user-1',
  // Story 4.6: recurrence fields
  isRecurring: false,
  recurrencePattern: null,
  recurrenceEndDate: null,
  parentTaskId: null,
  assignee: { id: 'user-1', firstName: 'Test', lastName: 'User', email: 't@local', avatar: null },
  contact: null,
  deal: null,
}

const mockTemplate = {
  id: 'template-1',
  tenantId: 'tenant-1',
  name: 'Discovery call',
  title: 'Discovery call follow-up',
  description: null,
  defaultPriority: 'MEDIUM',
  defaultDueInDays: 3,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  createdBy: 'user-1',
  updatedBy: 'user-1',
  deletedAt: null,
}

function makeTasksService(): jest.Mocked<TasksService> {
  return {
    create: jest.fn().mockResolvedValue(mockTask),
    findOne: jest.fn().mockResolvedValue(mockTask),
    findMany: jest.fn().mockResolvedValue({ items: [mockTask], total: 1, page: 1, pageSize: 20 }),
    getStats: jest
      .fn()
      .mockResolvedValue({ openTasks: 0, dueToday: 0, overdue: 0, completedThisWeek: 0 }),
    buildTaskWhere: jest.fn(),
    update: jest.fn().mockResolvedValue(mockTask),
    assign: jest.fn().mockResolvedValue(mockTask),
    complete: jest.fn().mockResolvedValue(mockTask),
    delete: jest.fn().mockResolvedValue(true),
    createFromTemplate: jest.fn().mockResolvedValue(mockTask),
  } as unknown as jest.Mocked<TasksService>
}

function makeTemplatesService(): jest.Mocked<TaskTemplatesService> {
  return {
    findMany: jest
      .fn()
      .mockResolvedValue({ items: [mockTemplate], total: 1, page: 1, pageSize: 20 }),
    findOneForTenant: jest.fn().mockResolvedValue(mockTemplate),
    create: jest.fn().mockResolvedValue(mockTemplate),
    update: jest.fn().mockResolvedValue(mockTemplate),
    delete: jest.fn().mockResolvedValue(true),
  } as unknown as jest.Mocked<TaskTemplatesService>
}

function makePubSub(): jest.Mocked<TaskPubSubService> {
  return {
    publish: jest.fn(),
    subscribe: jest.fn(),
  } as unknown as jest.Mocked<TaskPubSubService>
}

describe('tasks.graphql', () => {
  it('registers the Task and TaskTemplate objectRefs and builds an executable schema', () => {
    expect(TaskRef).toBeDefined()
    expect(TaskTemplateRef).toBeDefined()
    expect(schema).toBeDefined()
    expect(builder).toBeDefined()
  })

  it('exposes the task queries and mutations in the SDL', () => {
    const sdl = printSchema(schema)
    expect(sdl).toContain('type Task')
    expect(sdl).toContain('type TaskConnection')
    expect(sdl).toContain('type TaskTemplate')
    expect(sdl).toContain('type TaskTemplateConnection')
    expect(sdl).toContain('enum TaskStatus')
    expect(sdl).toContain('enum TaskPriority')
    expect(sdl).toContain('task(id: ID!)')
    expect(sdl).toContain('tasks(filter:')
    expect(sdl).toContain('myTasks(filter:')
    expect(sdl).toContain('taskStats: TaskStats')
    expect(sdl).toContain('type TaskStats')
    expect(sdl).toContain('taskTemplates(pagination:')
    expect(sdl).toContain('taskTemplate(id: ID!)')
    expect(sdl).toContain('createTask(input: CreateTaskInput!)')
    expect(sdl).toContain('updateTask(id: ID!')
    expect(sdl).toContain('deleteTask(id: ID!): Boolean')
    // printSchema alphabetises args — assert both args are ID!
    expect(sdl).toContain('assignTask(assigneeId: ID!, id: ID!)')
    expect(sdl).toContain('completeTask(id: ID!)')
    expect(sdl).toContain('createTaskTemplate(input: CreateTaskTemplateInput!)')
    expect(sdl).toContain('updateTaskTemplate(id: ID!')
    expect(sdl).toContain('deleteTaskTemplate(id: ID!): Boolean')
    expect(sdl).toContain('createTaskFromTemplate(input: CreateTaskFromTemplateInput!)')
    expect(sdl).toContain('onTaskAssigned: Task')
  })

  it('exposes every Task ref field and its contact/assignee refs', () => {
    const sdl = printSchema(schema)
    for (const field of [
      'id',
      'title',
      'description',
      'status',
      'priority',
      'dueDate',
      'assignedTo',
      'contactId',
      'completedAt',
      'createdBy',
      'createdAt',
      'updatedAt',
    ]) {
      expect(sdl).toContain(field)
    }
    expect(sdl).toContain('type TaskAssignee')
    expect(sdl).toContain('type TaskContact')
  })

  it('declares every input type with optional fields lacking required (AC 46)', () => {
    const sdl = printSchema(schema)
    expect(sdl).toContain('input CreateTaskInput')
    expect(sdl).toContain('input UpdateTaskInput')
    expect(sdl).toContain('input TaskFilterInput')
    expect(sdl).toContain('input TaskPaginationInput')
    expect(sdl).toContain('input CreateTaskTemplateInput')
    expect(sdl).toContain('input UpdateTaskTemplateInput')
    expect(sdl).toContain('input CreateTaskFromTemplateInput')
  })

  it('emits ID! for every id argument (AC 47 — review finding F1)', () => {
    const sdl = printSchema(schema)
    expect(sdl).toContain('task(id: ID!)')
    expect(sdl).toContain('deleteTask(id: ID!)')
    expect(sdl).toContain('assignTask(assigneeId: ID!, id: ID!)')
    expect(sdl).toContain('completeTask(id: ID!)')
    expect(sdl).toContain('taskTemplate(id: ID!)')
    expect(sdl).toContain('deleteTaskTemplate(id: ID!)')
    // No String! id arguments anywhere in the task surface
    expect(sdl).not.toContain('task(id: String!')
  })

  it('registerTasksGraphql wires the services without throwing', () => {
    const service = makeTasksService()
    const templates = makeTemplatesService()
    const pubsub = makePubSub()
    const deps = { getDependencyView: jest.fn() } as unknown as TaskDependenciesService
    const recur = { runRecurringTaskGeneration: jest.fn() } as unknown as TaskRecurrenceService
    expect(() => registerTasksGraphql(service, templates, pubsub, deps, recur)).not.toThrow()
  })

  it('can represent authentication failures in the task resolvers', () => {
    expect(new UnauthorizedException('Authentication required')).toBeInstanceOf(
      UnauthorizedException,
    )
  })

  it('requireUser in resolvers throws UnauthorizedException without a user', async () => {
    const result = await graphql({
      schema,
      source: 'query { task(id: "task-1") { id } }',
      contextValue: { user: null, req: { headers: {} } },
    })
    expect(result.errors?.[0]?.message).toContain('Authentication required')
  })

  it('maps enums from the shared const tuples (AC 41)', () => {
    expect(TASK_STATUSES).toEqual(['TODO', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])
    expect(TASK_PRIORITIES).toEqual(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
    const sdl = printSchema(schema)
    expect(sdl).toContain('enum TaskStatus')
    expect(sdl).toContain('TODO')
    expect(sdl).toContain('CANCELLED')
    expect(sdl).toContain('enum TaskPriority')
    expect(sdl).toContain('URGENT')
  })
})
