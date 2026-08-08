import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'

import type { Task } from '@/services/task.service'
import { TaskDetailClient } from '@/components/tasks/TaskDetailClient'
import { QueryProvider } from '@/components/contacts/QueryProvider'

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000'
const AUTH_COOKIE = 'auth-token'

type TaskPageProps = {
  params: { id: string }
}

type GraphqlTaskResponse = {
  data?: { task: Task }
  errors?: Array<{ message: string }>
}

// The inline selection set below is hand-duplicated from TASK_FIELDS in
// services/task.service.ts and will not stay in sync automatically — keep the
// two sets identical field-for-field (the same drift already exists between
// deals/[id]/page.tsx and deals/[id]/edit/page.tsx).
async function loadTask(id: string): Promise<Task> {
  const token = cookies().get(AUTH_COOKIE)?.value
  const response = await fetch(`${API_URL}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      query: `query Task($id: ID!) {
        task(id: $id) {
          id
          title
          description
          status
          priority
          dueDate
          assignedTo
          contactId
          dealId
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
          deal { id title }
        }
      }`,
      variables: { id },
    }),
    cache: 'no-store',
  })

  const payload = (await response.json().catch(() => ({}))) as GraphqlTaskResponse
  if (response.status === 401 || response.status === 403) {
    redirect('/login')
  }
  if (
    response.status === 404 ||
    payload.errors?.some((error) => error.message.includes('not found'))
  ) {
    notFound()
  }
  if (!response.ok || payload.errors?.length) {
    throw new Error(payload.errors?.[0]?.message ?? 'Unable to load task')
  }
  if (!payload.data?.task) {
    notFound()
  }
  return payload.data.task
}

export default async function TaskDetailPage({
  params,
}: TaskPageProps): Promise<React.JSX.Element> {
  const task = await loadTask(params.id)

  return (
    <QueryProvider>
      <TaskDetailClient task={task} />
    </QueryProvider>
  )
}
