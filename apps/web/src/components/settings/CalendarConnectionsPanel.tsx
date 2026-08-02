'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Calendar, RefreshCw, Unplug } from 'lucide-react'
import toast from 'react-hot-toast'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { TableSkeleton } from '@/components/shared/LoadingSkeleton'
import {
  CALENDAR_PROVIDERS,
  disconnectCalendar,
  getCalendarAuthUrl,
  getCalendarConnections,
  syncCalendar,
} from '@/services/calendar.service'
import type { CalendarConnection, CalendarProvider } from '@/services/calendar.service'

// Story 4.3 settings panel (AC 40): one row per provider (Google, Outlook),
// each either Connect or connected-with-status. Status badges use the
// Connected / Degraded / Disconnected vocabulary with colour PAIRED with text
// (WCAG 2.1 AA — never colour alone, AC 4).

const PROVIDER_LABELS: Record<CalendarProvider, string> = {
  GOOGLE: 'Google Calendar',
  OUTLOOK: 'Outlook Calendar',
}

function getStatusInfo(connection: CalendarConnection | undefined): {
  label: string
  className: string
} {
  if (!connection || connection.status === 'DISCONNECTED') {
    return { label: 'Not connected', className: 'bg-slate-50 text-slate-600 border-slate-200' }
  }
  if (connection.status === 'REAUTH_REQUIRED' || connection.lastSyncError) {
    return { label: 'Degraded', className: 'bg-amber-50 text-amber-700 border-amber-200' }
  }
  return { label: 'Connected', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
}

function formatLastSynced(iso: string | null): string {
  if (!iso) return 'Never synced'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Never synced'
  return `Last synced ${date.toLocaleString()}`
}

export function CalendarConnectionsPanel(): React.JSX.Element {
  const queryClient = useQueryClient()

  const {
    data: connections,
    error,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['calendarConnections'],
    queryFn: getCalendarConnections,
  })

  const syncMutation = useMutation({
    mutationFn: (provider: CalendarProvider) => syncCalendar(provider),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendarConnections'] })
    },
  })

  const disconnectMutation = useMutation({
    mutationFn: (provider: CalendarProvider) => disconnectCalendar(provider),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendarConnections'] })
    },
  })

  async function handleConnect(provider: CalendarProvider): Promise<void> {
    try {
      const { url } = await getCalendarAuthUrl(provider)
      // Remember which provider started this flow — the callback page needs
      // it to call connectCalendar (the state JWT is opaque to the client).
      sessionStorage.setItem('calendar-connect-provider', provider)
      // Full-page redirect to the provider's consent screen — the state is
      // bound server-side and verified in connectCalendar (AC 14).
      window.location.href = url
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to start calendar connection')
    }
  }

  async function handleSyncNow(provider: CalendarProvider): Promise<void> {
    try {
      await syncMutation.mutateAsync(provider)
      // Success copy states impact, not just "Synced" (UX Feedback Patterns).
      toast.success('Calendar synced — task changes now flow both ways')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Calendar sync failed')
    }
  }

  async function handleDisconnect(connection: CalendarConnection): Promise<void> {
    // The confirm states the real impact (AC 19/40): tasks stop syncing, and
    // events already in the user's calendar are LEFT IN PLACE.
    const confirmed = window.confirm(
      `Disconnect ${PROVIDER_LABELS[connection.provider]}? Tasks will stop syncing to this calendar. Events already in your calendar are left in place.`,
    )
    if (!confirmed) return
    try {
      await disconnectMutation.mutateAsync(connection.provider)
      toast.success(
        `${PROVIDER_LABELS[connection.provider]} disconnected — existing calendar events were kept`,
      )
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to disconnect calendar')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">Calendars</h2>
          <p className="mt-1 text-sm text-slate-600">
            Connect your Google Calendar or Outlook Calendar so CRM tasks appear there — and edits
            made in either place flow back to the other.
          </p>
        </div>
      </div>

      {isLoading && <TableSkeleton rows={2} columns={3} />}

      {error && (
        <ErrorState
          message={error instanceof Error ? error.message : 'Unable to load calendar connections.'}
          onRetry={() => refetch()}
        />
      )}

      {!isLoading && !error && connections && connections.length === 0 && (
        <EmptyState
          icon={<Calendar className="h-6 w-6" />}
          title="No calendars connected"
          description="Connect Google Calendar or Outlook Calendar to sync your tasks."
        />
      )}

      {!isLoading && !error && (
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="py-3 pr-4 pl-4 font-medium">Calendar</th>
                  <th className="py-3 pr-4 font-medium">Status</th>
                  <th className="py-3 pr-4 font-medium">Last synced</th>
                  <th className="py-3 pr-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {CALENDAR_PROVIDERS.map((provider) => {
                  const connection = connections?.find((c) => c.provider === provider)
                  const status = getStatusInfo(connection)
                  const connected = Boolean(connection && connection.status !== 'DISCONNECTED')
                  return (
                    <tr key={provider} className="group hover:bg-slate-50">
                      <td className="py-3 pr-4 pl-4 font-medium text-slate-900">
                        {PROVIDER_LABELS[provider]}
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${status.className}`}
                        >
                          {status.label}
                        </span>
                        {connection?.lastSyncError ? (
                          <p className="mt-1 text-xs text-amber-700">{connection.lastSyncError}</p>
                        ) : null}
                      </td>
                      <td className="py-3 pr-4 text-slate-600">
                        {formatLastSynced(connection?.lastSyncedAt ?? null)}
                      </td>
                      <td className="py-3 pr-4">
                        {connected && connection ? (
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleSyncNow(provider)}
                              disabled={syncMutation.isPending}
                              className="gap-1.5"
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                              Sync now
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDisconnect(connection)}
                              disabled={disconnectMutation.isPending}
                              className="gap-1.5 text-red-600 hover:bg-red-50"
                            >
                              <Unplug className="h-3.5 w-3.5" />
                              Disconnect
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleConnect(provider)}
                            className="gap-1.5"
                          >
                            <Calendar className="h-3.5 w-3.5" />
                            Connect
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
