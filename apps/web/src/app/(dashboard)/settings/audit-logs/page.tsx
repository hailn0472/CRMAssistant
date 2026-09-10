'use client'

import { useQuery } from '@tanstack/react-query'
import { useState, useCallback } from 'react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { TableSkeleton } from '@/components/shared/LoadingSkeleton'
import { Input } from '@/components/ui/input'
import { getAuditLogs, auditLogsToCsv } from '@/services/audit.service'
import type { AuditLogEntry } from '@/services/audit.service'

const ACTION_OPTIONS = [
  { value: 'ALL', label: 'All Actions' },
  { value: 'CREATE', label: 'CREATE' },
  { value: 'UPDATE', label: 'UPDATE' },
  { value: 'DELETE', label: 'DELETE' },
  { value: 'LOGIN', label: 'LOGIN' },
  { value: 'LOGOUT', label: 'LOGOUT' },
  { value: 'PERMISSION_CHANGE', label: 'PERMISSION CHANGE' },
  { value: 'API_KEY_CREATED', label: 'API KEY CREATED' },
  { value: 'API_KEY_REVOKED', label: 'API KEY REVOKED' },
  { value: 'API_KEY_ROTATED', label: 'API KEY ROTATED' },
  { value: 'ROLE_CREATED', label: 'ROLE CREATED' },
  { value: 'ROLE_UPDATED', label: 'ROLE UPDATED' },
  { value: 'ROLE_DELETED', label: 'ROLE DELETED' },
  { value: 'SHARE_CREATED', label: 'SHARE CREATED' },
  { value: 'SHARE_REVOKED', label: 'SHARE REVOKED' },
]

const ENTITY_OPTIONS = [
  { value: 'ALL', label: 'All Resources' },
  { value: 'CONTACT', label: 'CONTACT' },
  { value: 'USER', label: 'USER' },
  { value: 'ROLE', label: 'ROLE' },
  { value: 'PERMISSION', label: 'PERMISSION' },
  { value: 'SHARING_RULE', label: 'SHARING RULE' },
  { value: 'API_KEY', label: 'API KEY' },
]

function getActionBadgeClass(action: string): string {
  if (action.startsWith('CREATE') || action === 'API_KEY_CREATED')
    return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (action.startsWith('UPDATE') || action.startsWith('PERMISSION'))
    return 'bg-amber-50 text-amber-700 border-amber-200'
  if (action.startsWith('DELETE') || action === 'API_KEY_REVOKED')
    return 'bg-red-50 text-red-700 border-red-200'
  if (action === 'LOGIN') return 'bg-blue-50 text-blue-700 border-blue-200'
  if (action === 'LOGOUT') return 'bg-slate-50 text-slate-700 border-slate-200'
  return 'bg-purple-50 text-purple-700 border-purple-200'
}

function formatActionLabel(action: string): string {
  return action.replace(/_/g, ' ')
}

function DetailPanel({ log }: { log: AuditLogEntry }): React.JSX.Element {
  let parsedDetails: Record<string, unknown> | null = null
  try {
    if (log.details) parsedDetails = JSON.parse(log.details) as Record<string, unknown>
  } catch {
    parsedDetails = null
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
      <h4 className="mb-2 font-semibold text-slate-950">Event Details</h4>
      <dl className="space-y-2">
        <div className="flex gap-2">
          <dt className="w-24 shrink-0 font-medium text-slate-500">User Agent:</dt>
          <dd className="text-slate-700">{log.userAgent ?? '—'}</dd>
        </div>
        {parsedDetails && (
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 font-medium text-slate-500">Changes:</dt>
            <dd className="text-slate-700">
              <pre className="whitespace-pre-wrap text-xs">
                {JSON.stringify(parsedDetails, null, 2)}
              </pre>
            </dd>
          </div>
        )}
      </dl>
    </div>
  )
}

export default function AuditLogsPage(): React.JSX.Element {
  return <AuditLogsContent />
}

function AuditLogsContent(): React.JSX.Element {
  const [actionFilter, setActionFilter] = useState('ALL')
  const [entityFilter, setEntityFilter] = useState('ALL')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const filter = {
    action: actionFilter !== 'ALL' ? actionFilter : undefined,
    entity: entityFilter !== 'ALL' ? entityFilter : undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  }

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ['auditLogs', filter, page],
    queryFn: () => getAuditLogs(filter, { page, pageSize: 20 }),
  })

  const handleExport = useCallback(async (): Promise<void> => {
    if (!data) return
    setExporting(true)
    try {
      const PAGE_SIZE = 100
      const firstPage = await getAuditLogs(filter, { page: 1, pageSize: PAGE_SIZE })
      let items = firstPage.items
      if (firstPage.total > PAGE_SIZE) {
        const remainingPages = Math.ceil(firstPage.total / PAGE_SIZE) - 1
        const rest = await Promise.all(
          Array.from({ length: remainingPages }, (_, i) =>
            getAuditLogs(filter, { page: i + 2, pageSize: PAGE_SIZE }),
          ),
        )
        items = items.concat(...rest.map((r) => r.items))
      }
      const csv = auditLogsToCsv(items)
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }, [data, filter])

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 1

  return (
    <main className="space-y-6 p-6 text-slate-950">
      {/* Filter toolbar */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-slate-500" htmlFor="action-filter">
            Action
          </label>
          <select
            id="action-filter"
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value)
              setPage(1)
            }}
            className="flex h-10 w-40 rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:text-sm"
          >
            {ACTION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-slate-500" htmlFor="entity-filter">
            Resource Type
          </label>
          <select
            id="entity-filter"
            value={entityFilter}
            onChange={(e) => {
              setEntityFilter(e.target.value)
              setPage(1)
            }}
            className="flex h-10 w-40 rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:text-sm"
          >
            {ENTITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-slate-500" htmlFor="date-from">
            From
          </label>
          <Input
            id="date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value)
              setPage(1)
            }}
            className="w-40"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-slate-500" htmlFor="date-to">
            To
          </label>
          <Input
            id="date-to"
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value)
              setPage(1)
            }}
            className="w-40"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setActionFilter('ALL')
            setEntityFilter('ALL')
            setDateFrom('')
            setDateTo('')
            setPage(1)
          }}
        >
          Clear Filters
        </Button>
        {data && data.total > 0 && (
          <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
            {exporting ? 'Exporting...' : 'Export CSV'}
          </Button>
        )}
      </div>

      {/* Content */}
      {isLoading && <TableSkeleton rows={5} columns={6} />}

      {error && (
        <ErrorState
          message={error instanceof Error ? error.message : 'Unable to load audit logs.'}
          onRetry={() => refetch()}
        />
      )}

      {!isLoading && !error && data && data.items.length === 0 && (
        <EmptyState
          title="No audit logs yet"
          description={
            filter.action || filter.entity || filter.dateFrom || filter.dateTo
              ? 'No audit logs match the current filters. Try clearing some filters.'
              : 'Sensitive actions will appear here. Audit logging is automatic.'
          }
          action={
            filter.action || filter.entity || filter.dateFrom || filter.dateTo ? (
              <Button
                onClick={() => {
                  setActionFilter('ALL')
                  setEntityFilter('ALL')
                  setDateFrom('')
                  setDateTo('')
                  setPage(1)
                }}
              >
                Clear Filters
              </Button>
            ) : undefined
          }
        />
      )}

      {!isLoading && !error && data && data.items.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="py-3 pr-4 pl-4 font-medium">Timestamp</th>
                  <th className="py-3 pr-4 font-medium">User</th>
                  <th className="py-3 pr-4 font-medium">Action</th>
                  <th className="py-3 pr-4 font-medium">Resource Type</th>
                  <th className="py-3 pr-4 font-medium">Resource ID</th>
                  <th className="py-3 pr-4 font-medium">IP Address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((log) => (
                  <tr key={log.id} className="group hover:bg-slate-50">
                    <td className="py-3 pr-4 pl-4">
                      <button
                        type="button"
                        className="w-full text-left font-medium text-slate-900"
                        onClick={() => setExpandedRow(expandedRow === log.id ? null : log.id)}
                      >
                        {log.createdAt}
                      </button>
                    </td>
                    <td className="py-3 pr-4 text-slate-600">
                      {log.user
                        ? `${log.user.firstName} ${log.user.lastName}`
                        : log.userId.slice(0, 8)}
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${getActionBadgeClass(log.action)}`}
                      >
                        {formatActionLabel(log.action)}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-slate-600">{log.entity}</td>
                    <td className="py-3 pr-4 font-mono text-xs text-slate-500">
                      {log.entityId.slice(0, 8)}...
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs text-slate-500">
                      {log.ipAddress ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
            <span>
              Page {data.page} of {totalPages} ({data.total} total)
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Detail panel for expanded row */}
      {expandedRow &&
        data &&
        (() => {
          const log = data.items.find((l) => l.id === expandedRow)
          return log ? <DetailPanel log={log} /> : null
        })()}
    </main>
  )
}
