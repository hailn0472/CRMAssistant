import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { TasksService } from './tasks.service'
import { resolveVisibilityFilter } from '../common/guards/visibility-check'
import { wouldCreateCycle, DependencyGraphOverflowError } from './task-dependency-graph'
import { Prisma, type TaskStatus } from '@prisma/client'

// AC 20: soft-deleted and CANCELLED blockers do not block — only open statuses count.
const OPEN_STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS']

export type DependencyNode = {
  dependencyId: string
  taskId: string
  status: string
  restricted: boolean
  title: string | null
  priority: string | null
  dueDate: string | null
  assigneeName: string | null
}

export type DependencyView = {
  blockedBy: DependencyNode[]
  blocking: DependencyNode[]
  isBlocked: boolean
  openBlockerCount: number
}

@Injectable()
export class TaskDependenciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Story 4.6 (AC 16): add a directed dependency edge.
   * Edge direction: taskId is BLOCKED BY dependsOnTaskId.
   *
   * Steps:
   * a. Reject self-edge
   * b. Resolve BOTH ids through TasksService.findOne
   * c. Cycle check in Serializable transaction
   * d. Insert (P2002 → ConflictException)
   * e. Serializable transaction for check-then-insert
   * f. Audit row
   */
  async addTaskDependency(
    tenantId: string,
    userId: string,
    taskId: string,
    dependsOnTaskId: string,
  ): Promise<DependencyView> {
    // AC 16a: self-edge rejection
    if (taskId === dependsOnTaskId) {
      throw new BadRequestException('A task cannot depend on itself')
    }

    // AC 16b: resolve BOTH ids through TasksService.findOne
    await this.tasks.findOne(tenantId, userId, taskId)
    await this.tasks.findOne(tenantId, userId, dependsOnTaskId)

    // AC 16c-e: cycle check + insert in Serializable transaction
    try {
      await this.prisma.$transaction(
        async (tx) => {
          // Load ALL edges for the tenant
          const edges = await tx.taskDependency.findMany({
            where: { tenantId },
            select: { taskId: true, dependsOnTaskId: true },
          })

          // Cycle check
          if (wouldCreateCycle(taskId, dependsOnTaskId, edges)) {
            throw new BadRequestException('Adding this dependency would create a cycle')
          }

          // Insert
          await tx.taskDependency.create({
            data: {
              tenantId,
              taskId,
              dependsOnTaskId,
              createdBy: userId,
            },
          })
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      )
    } catch (error) {
      // AC 16d: P2002 → ConflictException
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This dependency already exists')
      }
      // AC 16e: P2034 → ConflictException
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        throw new ConflictException('Conflict while adding dependency')
      }
      // Re-throw graph overflow as BadRequestException (AC 13)
      if (error instanceof DependencyGraphOverflowError) {
        throw new BadRequestException(
          'Dependency graph is too large to validate (limit: 500 tasks / depth 50)',
        )
      }
      // Re-throw known exceptions
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException ||
        error instanceof NotFoundException
      ) {
        throw error
      }
      throw error
    }

    // AC 16f: audit row
    await this.audit.log({
      tenantId,
      userId,
      action: 'CREATE',
      entity: 'TASK_DEPENDENCY',
      entityId: `${taskId}-${dependsOnTaskId}`,
      details: {
        mutationName: 'addTaskDependency',
        taskId,
        dependsOnTaskId,
      },
    })

    return this.getDependencyView(tenantId, userId, taskId)
  }

  /**
   * Story 4.6 (AC 17): remove a dependency edge (hard delete).
   */
  async removeTaskDependency(
    tenantId: string,
    userId: string,
    dependencyId: string,
  ): Promise<DependencyView> {
    // Load the row scoped by tenantId
    const dependency = await this.prisma.taskDependency.findFirst({
      where: { id: dependencyId, tenantId },
      select: { id: true, taskId: true },
    })

    if (!dependency) {
      throw new NotFoundException('Dependency not found')
    }

    // Resolve the taskId through TasksService.findOne (visibility oracle)
    const task = await this.tasks.findOne(tenantId, userId, dependency.taskId)

    // Hard delete
    const result = await this.prisma.taskDependency.deleteMany({
      where: { id: dependencyId, tenantId },
    })

    if (result.count === 0) {
      throw new NotFoundException('Dependency not found')
    }

    // Audit
    await this.audit.log({
      tenantId,
      userId,
      action: 'DELETE',
      entity: 'TASK_DEPENDENCY',
      entityId: dependencyId,
      details: {
        mutationName: 'removeTaskDependency',
        taskId: dependency.taskId,
      },
    })

    return this.getDependencyView(tenantId, userId, task.id)
  }

  /**
   * Story 4.6 (AC 18): get the dependency view for a task.
   * Returns blockedBy, blocking, isBlocked, openBlockerCount.
   * Two round trips per direction (not N+1).
   * AC 45: per-node visibility resolved once, compared in memory.
   */
  async getDependencyView(
    tenantId: string,
    userId: string,
    taskId: string,
  ): Promise<DependencyView> {
    // Resolve visibility once
    const rawVisibilityFilter = await resolveVisibilityFilter(userId, tenantId)
    const visibilityFilter = rawVisibilityFilter as string | { in: string[] } | undefined

    // AC 18: one round trip per direction
    const [blockedByEdges, blockingEdges] = await Promise.all([
      // Edges where THIS task is blocked (taskId matches, load the blocker)
      this.prisma.taskDependency.findMany({
        where: { tenantId, taskId },
        select: {
          id: true,
          dependsOnTask: {
            select: {
              id: true,
              title: true,
              status: true,
              priority: true,
              dueDate: true,
              assignedTo: true,
              deletedAt: true,
              assignee: {
                select: { firstName: true, lastName: true },
              },
            },
          },
        },
      }),
      // Edges where THIS task blocks others (dependsOnTaskId matches, load the dependent)
      this.prisma.taskDependency.findMany({
        where: { tenantId, dependsOnTaskId: taskId },
        select: {
          id: true,
          task: {
            select: {
              id: true,
              title: true,
              status: true,
              priority: true,
              dueDate: true,
              assignedTo: true,
              deletedAt: true,
              assignee: {
                select: { firstName: true, lastName: true },
              },
            },
          },
        },
      }),
    ])

    // Map nodes, applying visibility
    const blockedByNodes: DependencyNode[] = []
    let openBlockerCount = 0

    for (const edge of blockedByEdges) {
      const node = edge.dependsOnTask
      // AC 20: soft-deleted blockers are excluded
      if (node.deletedAt !== null) continue

      const isVisible = this.checkVisibility(node.assignedTo as string, visibilityFilter)
      const isOpen = OPEN_STATUSES.includes(node.status as (typeof OPEN_STATUSES)[number])

      if (isOpen) openBlockerCount++

      blockedByNodes.push({
        dependencyId: edge.id,
        taskId: node.id,
        status: node.status,
        restricted: !isVisible,
        title: isVisible ? node.title : null,
        priority: isVisible ? node.priority : null,
        dueDate: node.dueDate?.toISOString() ?? null,
        assigneeName:
          isVisible && node.assignee
            ? `${node.assignee.firstName} ${node.assignee.lastName}`
            : null,
      })
    }

    const blockingNodes: DependencyNode[] = []
    for (const edge of blockingEdges) {
      const node = edge.task
      if (node.deletedAt !== null) continue

      const isVisible = this.checkVisibility(String(node.assignedTo), visibilityFilter)

      blockingNodes.push({
        dependencyId: edge.id,
        taskId: node.id,
        status: node.status,
        restricted: !isVisible,
        title: isVisible ? node.title : null,
        priority: isVisible ? node.priority : null,
        dueDate: node.dueDate?.toISOString() ?? null,
        assigneeName:
          isVisible && node.assignee
            ? `${node.assignee.firstName} ${node.assignee.lastName}`
            : null,
      })
    }

    return {
      blockedBy: blockedByNodes,
      blocking: blockingNodes,
      isBlocked: openBlockerCount > 0,
      openBlockerCount,
    }
  }

  /**
   * AC 45: check if a node's assignedTo is visible to the caller.
   * Mirrors the visibility logic in TasksService.findOne.
   */
  private checkVisibility(
    assignedTo: string,
    visibilityFilter: string | { in: string[] } | undefined,
  ): boolean {
    if (visibilityFilter === undefined) return true // ALL visibility
    if (typeof visibilityFilter === 'string') {
      return assignedTo === visibilityFilter
    }
    return visibilityFilter.in.includes(assignedTo)
  }
}
