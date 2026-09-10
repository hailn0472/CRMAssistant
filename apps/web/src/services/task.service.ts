import { graphqlRequest } from '@/lib/graphql-client'

export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'

export type TaskAssignee = {
  id: string
  firstName: string
  lastName: string
  email: string
  avatar?: string | null
}

export type TaskContact = {
  id: string
  firstName: string
  lastName: string
  email: string
}

export type Task = {
  id: string
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  dueDate: string | null
  assignedTo: string
  contactId: string | null
  completedAt: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  // Story 4.6: recurrence fields (AC 50)
  isRecurring: boolean
  recurrencePattern: string | null
  recurrenceEndDate: string | null
  parentTaskId: string | null
  assignee: TaskAssignee | null
  contact: TaskContact | null
}

// Story 4.6: dependency types (AC 49)
export type TaskDependencyNode = {
  dependencyId: string
  taskId: string
  status: TaskStatus
  restricted: boolean
  title: string | null
  priority: string | null
  dueDate: string | null
  assigneeName: string | null
}

export type TaskDependencyView = {
  blockedBy: TaskDependencyNode[]
  blocking: TaskDependencyNode[]
  isBlocked: boolean
  openBlockerCount: number
}

export type TaskConnection = {
  items: Task[]
  total: number
  page: number
  pageSize: number
}

export type TaskTemplate = {
  id: string
  name: string
  title: string
  description: string | null
  defaultPriority: TaskPriority
  defaultDueInDays: number | null
  createdAt: string
  updatedAt: string
}

export type TaskTemplateConnection = {
  items: TaskTemplate[]
  total: number
  page: number
  pageSize: number
}

export type TaskFormData = {
  title: string
  description?: string | null
  status?: TaskStatus
  priority?: TaskPriority
  dueDate?: string | null
  assignedTo?: string
  contactId?: string
  // Story 4.6: recurrence fields
  isRecurring?: boolean
  recurrencePattern?: string
  recurrenceEndDate?: string | null
}

export type TaskFilter = {
  search?: string
  status?: TaskStatus
  priority?: TaskPriority
  assignedTo?: string
  contactId?: string
  dueDateFrom?: string
  dueDateTo?: string
  overdueOnly?: boolean
}

export type TaskStats = {
  openTasks: number
  dueToday: number
  overdue: number
  completedThisWeek: number
}

// Story 4.4 (AC 12): mirrors the server's TaskSortField enum — an explicit
// enum, never a free-text column name (client-supplied orderBy is an
// injection surface).
export const TASK_SORT_FIELDS = ['DUE_DATE', 'PRIORITY', 'CREATED_AT', 'TITLE'] as const
export type TaskSortField = (typeof TASK_SORT_FIELDS)[number]
export type TaskSortDirection = 'ASC' | 'DESC'
export type TaskSort = { field: TaskSortField; direction: TaskSortDirection }

// Exported so activity.service.ts can build ON_TASK_CHANGED_SUBSCRIPTION from
// the SAME field list (Story 4.4, AC 36) — two copies would silently drift.
// Story 4.6 (AC 50): +4 fields for recurrence — MUST stay in sync with
// the Task TypeScript type and the server's taskListSelect.
export const TASK_FIELDS = `
  id
  title
  description
  status
  priority
  dueDate
  assignedTo
  contactId
  completedAt
  createdBy
  createdAt
  updatedAt
  isRecurring
  recurrencePattern
  recurrenceEndDate
  parentTaskId
  assignee { id firstName lastName email avatar }
  contact { id firstName lastName email }
`

export async function getTasks(
  page: number,
  pageSize: number,
  filter?: TaskFilter,
  sort?: TaskSort,
): Promise<TaskConnection> {
  const data = await graphqlRequest<{ tasks: TaskConnection }>(
    `query Tasks($filter: TaskFilterInput, $pagination: TaskPaginationInput, $sort: TaskSortInput) {
      tasks(filter: $filter, pagination: $pagination, sort: $sort) {
        total
        page
        pageSize
        items { ${TASK_FIELDS} }
      }
    }`,
    {
      filter: filter ?? undefined,
      pagination: { page, pageSize },
      sort: sort ?? undefined,
    },
  )
  return data.tasks
}

export async function getMyTasks(
  page: number,
  pageSize: number,
  filter?: TaskFilter,
): Promise<TaskConnection> {
  const data = await graphqlRequest<{ myTasks: TaskConnection }>(
    `query MyTasks($filter: TaskFilterInput, $pagination: TaskPaginationInput) {
      myTasks(filter: $filter, pagination: $pagination) {
        total
        page
        pageSize
        items { ${TASK_FIELDS} }
      }
    }`,
    {
      filter: filter ?? undefined,
      pagination: { page, pageSize },
    },
  )
  return data.myTasks
}

export async function getTaskStats(): Promise<TaskStats> {
  const data = await graphqlRequest<{ taskStats: TaskStats }>(
    `query TaskStats {
      taskStats { openTasks dueToday overdue completedThisWeek }
    }`,
    {},
  )
  return data.taskStats
}

export async function getTask(id: string): Promise<Task> {
  const data = await graphqlRequest<{ task: Task }>(
    `query Task($id: ID!) {
      task(id: $id) { ${TASK_FIELDS} }
    }`,
    { id },
  )
  return data.task
}

export async function createTask(input: TaskFormData): Promise<Task> {
  const data = await graphqlRequest<{ createTask: Task }>(
    `mutation CreateTask($input: CreateTaskInput!) {
      createTask(input: $input) { ${TASK_FIELDS} }
    }`,
    { input },
  )
  return data.createTask
}

export async function updateTask(id: string, input: Partial<TaskFormData>): Promise<Task> {
  const data = await graphqlRequest<{ updateTask: Task }>(
    `mutation UpdateTask($id: ID!, $input: UpdateTaskInput!) {
      updateTask(id: $id, input: $input) { ${TASK_FIELDS} }
    }`,
    { id, input },
  )
  return data.updateTask
}

export async function deleteTask(id: string): Promise<boolean> {
  const data = await graphqlRequest<{ deleteTask: boolean }>(
    `mutation DeleteTask($id: ID!) {
      deleteTask(id: $id)
    }`,
    { id },
  )
  return data.deleteTask
}

export async function assignTask(id: string, assigneeId: string): Promise<Task> {
  const data = await graphqlRequest<{ assignTask: Task }>(
    `mutation AssignTask($id: ID!, $assigneeId: ID!) {
      assignTask(id: $id, assigneeId: $assigneeId) { ${TASK_FIELDS} }
    }`,
    { id, assigneeId },
  )
  return data.assignTask
}

export async function completeTask(id: string): Promise<Task> {
  const data = await graphqlRequest<{ completeTask: Task }>(
    `mutation CompleteTask($id: ID!) {
      completeTask(id: $id) { ${TASK_FIELDS} }
    }`,
    { id },
  )
  return data.completeTask
}

export async function getTaskTemplates(
  page: number,
  pageSize: number,
): Promise<TaskTemplateConnection> {
  const data = await graphqlRequest<{ taskTemplates: TaskTemplateConnection }>(
    `query TaskTemplates($pagination: TaskPaginationInput) {
      taskTemplates(pagination: $pagination) {
        total
        page
        pageSize
        items { id name title description defaultPriority defaultDueInDays createdAt updatedAt }
      }
    }`,
    { pagination: { page, pageSize } },
  )
  return data.taskTemplates
}

export async function createTaskTemplate(
  input: Pick<TaskTemplate, 'name' | 'title'> & {
    description?: string | null
    defaultPriority?: TaskPriority
    defaultDueInDays?: number | null
  },
): Promise<TaskTemplate> {
  const data = await graphqlRequest<{ createTaskTemplate: TaskTemplate }>(
    `mutation CreateTaskTemplate($input: CreateTaskTemplateInput!) {
      createTaskTemplate(input: $input) {
        id name title description defaultPriority defaultDueInDays createdAt updatedAt
      }
    }`,
    { input },
  )
  return data.createTaskTemplate
}

export async function updateTaskTemplate(
  id: string,
  input: Partial<{
    name: string
    title: string
    description: string | null
    defaultPriority: TaskPriority
    defaultDueInDays: number | null
  }>,
): Promise<TaskTemplate> {
  const data = await graphqlRequest<{ updateTaskTemplate: TaskTemplate }>(
    `mutation UpdateTaskTemplate($id: ID!, $input: UpdateTaskTemplateInput!) {
      updateTaskTemplate(id: $id, input: $input) {
        id name title description defaultPriority defaultDueInDays createdAt updatedAt
      }
    }`,
    { id, input },
  )
  return data.updateTaskTemplate
}

export async function deleteTaskTemplate(id: string): Promise<boolean> {
  const data = await graphqlRequest<{ deleteTaskTemplate: boolean }>(
    `mutation DeleteTaskTemplate($id: ID!) {
      deleteTaskTemplate(id: $id)
    }`,
    { id },
  )
  return data.deleteTaskTemplate
}

export async function createTaskFromTemplate(
  templateId: string,
  overrides: {
    assignedTo?: string
    contactId?: string
    dueDate?: string
    title?: string
  },
): Promise<Task> {
  const data = await graphqlRequest<{ createTaskFromTemplate: Task }>(
    `mutation CreateTaskFromTemplate($input: CreateTaskFromTemplateInput!) {
      createTaskFromTemplate(input: $input) { ${TASK_FIELDS} }
    }`,
    { input: { templateId, ...overrides } },
  )
  return data.createTaskFromTemplate
}

export const ON_TASK_ASSIGNED_SUBSCRIPTION = `subscription OnTaskAssigned {
  onTaskAssigned {
    ${TASK_FIELDS}
  }
}`

// Story 4.4 (AC 14/36): tenant-wide task-change subscription, published by
// TasksService on create/update/assign/complete/delete. The payload only
// needs the id to invalidate; the full field list keeps the cache warm for
// the list view.
export const ON_TASK_CHANGED_SUBSCRIPTION = `subscription OnTaskChanged {
  onTaskChanged {
    ${TASK_FIELDS}
  }
}`

// Story 4.6: dependency documents (AC 49)
export const TASK_DEPENDENCY_FIELDS = `
  dependencyId
  taskId
  status
  restricted
  title
  priority
  dueDate
  assigneeName
`

export async function getTaskDependencies(taskId: string): Promise<TaskDependencyView> {
  const data = await graphqlRequest<{ taskDependencies: TaskDependencyView }>(
    `query TaskDependencies($taskId: ID!) {
      taskDependencies(taskId: $taskId) {
        blockedBy { ${TASK_DEPENDENCY_FIELDS} }
        blocking { ${TASK_DEPENDENCY_FIELDS} }
        isBlocked
        openBlockerCount
      }
    }`,
    { taskId },
  )
  return data.taskDependencies
}

export async function addTaskDependency(
  taskId: string,
  dependsOnTaskId: string,
): Promise<TaskDependencyView> {
  const data = await graphqlRequest<{ addTaskDependency: TaskDependencyView }>(
    `mutation AddTaskDependency($taskId: ID!, $dependsOnTaskId: ID!) {
      addTaskDependency(taskId: $taskId, dependsOnTaskId: $dependsOnTaskId) {
        blockedBy { ${TASK_DEPENDENCY_FIELDS} }
        blocking { ${TASK_DEPENDENCY_FIELDS} }
        isBlocked
        openBlockerCount
      }
    }`,
    { taskId, dependsOnTaskId },
  )
  return data.addTaskDependency
}

export async function removeTaskDependency(dependencyId: string): Promise<TaskDependencyView> {
  const data = await graphqlRequest<{ removeTaskDependency: TaskDependencyView }>(
    `mutation RemoveTaskDependency($dependencyId: ID!) {
      removeTaskDependency(dependencyId: $dependencyId) {
        blockedBy { ${TASK_DEPENDENCY_FIELDS} }
        blocking { ${TASK_DEPENDENCY_FIELDS} }
        isBlocked
        openBlockerCount
      }
    }`,
    { dependencyId },
  )
  return data.removeTaskDependency
}
