import { graphqlRequest } from './team.service'

export type AuditLogEntry = {
  id: string
  userId: string
  action: string
  entity: string
  entityId: string
  details: string | null
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
  user: {
    id: string
    email: string
    firstName: string
    lastName: string
  } | null
}

export type AuditLogConnection = {
  items: AuditLogEntry[]
  total: number
  page: number
  pageSize: number
}

export type AuditLogFilter = {
  userId?: string
  action?: string
  entity?: string
  dateFrom?: string
  dateTo?: string
}

const AUDIT_LOGS_QUERY = `query AuditLogs($filter: AuditLogFilterInput, $pagination: AuditLogPaginationInput) {
  auditLogs(filter: $filter, pagination: $pagination) {
    items {
      id
      userId
      action
      entity
      entityId
      details
      ipAddress
      userAgent
      createdAt
      user {
        id
        email
        firstName
        lastName
      }
    }
    total
    page
    pageSize
  }
}`

export async function getAuditLogs(
  filter: AuditLogFilter,
  pagination: { page?: number; pageSize?: number },
): Promise<AuditLogConnection> {
  const variables: Record<string, unknown> = {}
  const f: Record<string, unknown> = {}

  if (filter.userId) f.userId = filter.userId
  if (filter.action) f.action = filter.action
  if (filter.entity) f.entity = filter.entity
  if (filter.dateFrom) f.dateFrom = filter.dateFrom
  if (filter.dateTo) f.dateTo = filter.dateTo

  if (Object.keys(f).length > 0) variables.filter = f
  if (pagination.page || pagination.pageSize) variables.pagination = pagination

  const data = await graphqlRequest<{ auditLogs: AuditLogConnection }>(AUDIT_LOGS_QUERY, variables)
  return data.auditLogs
}

export function auditLogsToCsv(logs: AuditLogEntry[]): string {
  const headers = [
    'Timestamp',
    'User',
    'Action',
    'Resource Type',
    'Resource ID',
    'IP Address',
    'Details',
  ]
  const rows = logs.map((log) => [
    log.createdAt,
    log.user ? `${log.user.firstName} ${log.user.lastName}` : log.userId,
    log.action,
    log.entity,
    log.entityId,
    log.ipAddress ?? '',
    log.details ?? '',
  ])

  const escapeCsv = (val: string): string => {
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
      return `"${val.replace(/"/g, '""')}"`
    }
    return val
  }

  return [headers.join(','), ...rows.map((row) => row.map(escapeCsv).join(','))].join('\n')
}
