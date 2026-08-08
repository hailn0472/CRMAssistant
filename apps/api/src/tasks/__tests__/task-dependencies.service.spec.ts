// Mock visibility-check at module top
jest.mock('../../common/guards/visibility-check', () => ({
  resolveVisibilityFilter: jest.fn(),
  registerVisibilityService: jest.fn(),
}))

import { resolveVisibilityFilter } from '../../common/guards/visibility-check'
import { TaskDependenciesService } from '../task-dependencies.service'
import { TasksService } from '../tasks.service'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'
import type { PrismaService } from '../../prisma/prisma.service'
import type { AuditService } from '../../audit/audit.service'

const mockResolveVisibilityFilter = resolveVisibilityFilter as jest.Mock

const TENANT = 'tenant-1'
const USER = 'user-1'

function makeTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'task-1',
    tenantId: TENANT,
    title: 'Test task',
    description: null,
    status: 'TODO',
    priority: 'MEDIUM',
    dueDate: null,
    assignedTo: USER,
    contactId: null,
    dealId: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: USER,
    updatedBy: USER,
    assignee: { id: USER, firstName: 'Test', lastName: 'User', email: 'test@local', avatar: null },
    contact: null,
    deal: null,
    ...overrides,
  }
}

interface MockPrisma {
  taskDependency: {
    findFirst: jest.Mock
    findMany: jest.Mock
    create: jest.Mock
    deleteMany: jest.Mock
    count: jest.Mock
  }
  task: {
    findFirst: jest.Mock
    findMany: jest.Mock
  }
  $transaction: jest.Mock
}

function buildPrismaMock(): MockPrisma {
  const taskDependency = {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn(),
  }
  const task = {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  }
  return {
    taskDependency,
    task,
    $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb({ taskDependency })),
  }
}

interface MockServiceBundle {
  service: TaskDependenciesService
  tasks: { findOne: jest.Mock }
  audit: { log: jest.Mock }
}

function makeService(prisma: MockPrisma): MockServiceBundle {
  const tasks = {
    findOne: jest.fn().mockResolvedValue(makeTask()),
  }
  const audit = { log: jest.fn() }
  const service = new TaskDependenciesService(
    prisma as unknown as PrismaService,
    tasks as unknown as TasksService,
    audit as unknown as AuditService,
  )
  return { service, tasks, audit }
}

describe('TaskDependenciesService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>

  beforeEach(() => {
    jest.clearAllMocks()
    prisma = buildPrismaMock()
    mockResolveVisibilityFilter.mockResolvedValue(undefined) // ALL visibility
  })

  describe('addTaskDependency()', () => {
    it('rejects self-edge with BadRequestException', async () => {
      const { service } = makeService(prisma)
      await expect(service.addTaskDependency(TENANT, USER, 'task-1', 'task-1')).rejects.toThrow(
        'A task cannot depend on itself',
      )
    })

    it('resolves both task ids through TasksService.findOne', async () => {
      const { service, tasks } = makeService(prisma)
      prisma.taskDependency.findMany.mockResolvedValue([])
      prisma.taskDependency.create.mockResolvedValue({})

      await service.addTaskDependency(TENANT, USER, 'task-a', 'task-b')

      expect(tasks.findOne).toHaveBeenCalledWith(TENANT, USER, 'task-a')
      expect(tasks.findOne).toHaveBeenCalledWith(TENANT, USER, 'task-b')
    })

    it('rejects with BadRequestException when cycle would be created', async () => {
      const { service } = makeService(prisma)
      // Existing edge: task-b depends on task-a
      prisma.taskDependency.findMany.mockResolvedValue([
        { taskId: 'task-b', dependsOnTaskId: 'task-a' },
      ])

      // Adding task-a depends on task-b → cycle
      await expect(service.addTaskDependency(TENANT, USER, 'task-a', 'task-b')).rejects.toThrow(
        'Adding this dependency would create a cycle',
      )
    })

    it('inserts and returns the dependency view on success', async () => {
      const { service } = makeService(prisma)
      prisma.taskDependency.findMany
        .mockResolvedValueOnce([]) // edges for cycle check
        .mockResolvedValueOnce([]) // blockedBy query
        .mockResolvedValueOnce([]) // blocking query
      prisma.taskDependency.create.mockResolvedValue({})

      const result = await service.addTaskDependency(TENANT, USER, 'task-a', 'task-b')

      expect(prisma.taskDependency.create).toHaveBeenCalled()
      expect(result).toHaveProperty('blockedBy')
      expect(result).toHaveProperty('blocking')
    })

    it('maps P2002 to ConflictException (duplicate dependency)', async () => {
      const { service } = makeService(prisma)
      const p2002Error = new PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: '5.0.0',
        meta: { target: ['tenantId', 'taskId', 'dependsOnTaskId'] },
      })
      prisma.taskDependency.findMany.mockResolvedValue([])
      prisma.$transaction.mockImplementation(async () => {
        throw p2002Error
      })

      await expect(service.addTaskDependency(TENANT, USER, 'task-a', 'task-b')).rejects.toThrow(
        'This dependency already exists',
      )
    })

    it('writes an audit row on successful add', async () => {
      const { service, audit } = makeService(prisma)
      prisma.taskDependency.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
      prisma.taskDependency.create.mockResolvedValue({})

      await service.addTaskDependency(TENANT, USER, 'task-a', 'task-b')

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT,
          userId: USER,
          action: 'CREATE',
          entity: 'TASK_DEPENDENCY',
          details: expect.objectContaining({
            mutationName: 'addTaskDependency',
          }),
        }),
      )
    })
  })

  describe('removeTaskDependency()', () => {
    it('throws NotFoundException when dependency not found', async () => {
      const { service } = makeService(prisma)
      prisma.taskDependency.findFirst.mockResolvedValue(null)

      await expect(service.removeTaskDependency(TENANT, USER, 'dep-1')).rejects.toThrow(
        'Dependency not found',
      )
    })

    it('hard-deletes and returns the dependency view', async () => {
      const { service } = makeService(prisma)
      prisma.taskDependency.findFirst.mockResolvedValue({
        id: 'dep-1',
        taskId: 'task-a',
      })
      prisma.taskDependency.deleteMany.mockResolvedValue({ count: 1 })
      prisma.taskDependency.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])

      const result = await service.removeTaskDependency(TENANT, USER, 'dep-1')

      expect(prisma.taskDependency.deleteMany).toHaveBeenCalledWith({
        where: { id: 'dep-1', tenantId: TENANT },
      })
      expect(result).toHaveProperty('blockedBy')
    })

    it('writes an audit row on successful remove', async () => {
      const { service, audit } = makeService(prisma)
      prisma.taskDependency.findFirst.mockResolvedValue({
        id: 'dep-1',
        taskId: 'task-a',
      })
      prisma.taskDependency.deleteMany.mockResolvedValue({ count: 1 })
      prisma.taskDependency.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])

      await service.removeTaskDependency(TENANT, USER, 'dep-1')

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DELETE',
          entity: 'TASK_DEPENDENCY',
        }),
      )
    })
  })

  describe('getDependencyView()', () => {
    it('returns empty arrays when no dependencies exist', async () => {
      const { service } = makeService(prisma)
      prisma.taskDependency.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])

      const result = await service.getDependencyView(TENANT, USER, 'task-1')

      expect(result.blockedBy).toEqual([])
      expect(result.blocking).toEqual([])
      expect(result.isBlocked).toBe(false)
      expect(result.openBlockerCount).toBe(0)
    })

    it('excludes soft-deleted blockers', async () => {
      const { service } = makeService(prisma)
      prisma.taskDependency.findMany
        .mockResolvedValueOnce([
          {
            id: 'dep-1',
            dependsOnTask: {
              id: 'task-b',
              title: 'Blocker',
              status: 'TODO',
              priority: 'MEDIUM',
              dueDate: null,
              assignedTo: 'user-1',
              deletedAt: new Date(), // soft-deleted
              assignee: { firstName: 'Test', lastName: 'User' },
            },
          },
        ])
        .mockResolvedValueOnce([])

      const result = await service.getDependencyView(TENANT, USER, 'task-1')

      expect(result.blockedBy).toEqual([])
      expect(result.isBlocked).toBe(false)
    })

    it('excludes CANCELLED blockers from openBlockerCount', async () => {
      const { service } = makeService(prisma)
      prisma.taskDependency.findMany
        .mockResolvedValueOnce([
          {
            id: 'dep-1',
            dependsOnTask: {
              id: 'task-b',
              title: 'Cancelled blocker',
              status: 'CANCELLED',
              priority: 'MEDIUM',
              dueDate: null,
              assignedTo: 'user-1',
              deletedAt: null,
              assignee: { firstName: 'Test', lastName: 'User' },
            },
          },
        ])
        .mockResolvedValueOnce([])

      const result = await service.getDependencyView(TENANT, USER, 'task-1')

      expect(result.blockedBy).toHaveLength(1)
      expect(result.isBlocked).toBe(false)
      expect(result.openBlockerCount).toBe(0)
    })

    it('marks non-visible nodes as restricted', async () => {
      mockResolveVisibilityFilter.mockResolvedValue('someone-else')
      const { service } = makeService(prisma)
      prisma.taskDependency.findMany
        .mockResolvedValueOnce([
          {
            id: 'dep-1',
            dependsOnTask: {
              id: 'task-b',
              title: 'Hidden task',
              status: 'TODO',
              priority: 'MEDIUM',
              dueDate: null,
              assignedTo: 'user-1',
              deletedAt: null,
              assignee: { firstName: 'Hidden', lastName: 'Task' },
            },
          },
        ])
        .mockResolvedValueOnce([])

      const result = await service.getDependencyView(TENANT, USER, 'task-1')

      expect(result.blockedBy[0].restricted).toBe(true)
      expect(result.blockedBy[0].title).toBeNull()
      expect(result.blockedBy[0].assigneeName).toBeNull()
    })
  })
})
