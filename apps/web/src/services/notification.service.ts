import { graphqlRequest } from '@/lib/graphql-client'

export type Notification = {
  id: string
  type: string
  title: string
  body: string | null
  taskId: string | null
  reportExportId?: string | null
  readAt: string | null
  createdAt: string
}

export type NotificationConnection = {
  items: Notification[]
  total: number
  page: number
  pageSize: number
}

/**
 * Keep NOTIFICATION_FIELDS in lockstep with NotificationRef / NOTIFICATION_SELECT.
 * A field missing from this fragment is silently undefined at runtime —
 * there is no GraphQL codegen (activity.service.ts:10-12).
 */
export const NOTIFICATION_FIELDS = `
  id
  type
  title
  body
  taskId
  reportExportId
  readAt
  createdAt
`

export type NotificationFilterInput = {
  unreadOnly?: boolean
}

export type NotificationPaginationInput = {
  page?: number
  pageSize?: number
}

export async function getNotifications(
  filter: NotificationFilterInput = {},
  pagination: NotificationPaginationInput = {},
): Promise<NotificationConnection> {
  const data = await graphqlRequest<{ notifications: NotificationConnection }>(
    `query Notifications($filter: NotificationFilterInput, $pagination: NotificationPaginationInput) {
      notifications(filter: $filter, pagination: $pagination) {
        total
        page
        pageSize
        items { ${NOTIFICATION_FIELDS} }
      }
    }`,
    {
      filter: { unreadOnly: filter.unreadOnly ?? undefined },
      pagination: {
        page: pagination.page ?? undefined,
        pageSize: pagination.pageSize ?? undefined,
      },
    },
  )
  return data.notifications
}

export async function getUnreadNotificationCount(): Promise<number> {
  const data = await graphqlRequest<{ unreadNotificationCount: number }>(
    `query UnreadNotificationCount {
      unreadNotificationCount
    }`,
    {},
  )
  return data.unreadNotificationCount
}

export async function markNotificationRead(id: string): Promise<Notification> {
  const data = await graphqlRequest<{ markNotificationRead: Notification }>(
    `mutation MarkNotificationRead($id: ID!) {
      markNotificationRead(id: $id) { ${NOTIFICATION_FIELDS} }
    }`,
    { id },
  )
  return data.markNotificationRead
}

export async function markAllNotificationsRead(): Promise<number> {
  const data = await graphqlRequest<{ markAllNotificationsRead: number }>(
    `mutation MarkAllNotificationsRead {
      markAllNotificationsRead
    }`,
    {},
  )
  return data.markAllNotificationsRead
}

export const ON_NOTIFICATION_RECEIVED_SUBSCRIPTION = `
  subscription OnNotificationReceived {
    onNotificationReceived { ${NOTIFICATION_FIELDS} }
  }
`
