'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Facebook } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { TableSkeleton } from '@/components/shared/LoadingSkeleton'
import { QueryProvider } from '@/components/contacts/QueryProvider'
import { getFacebookPages, disconnectFacebookPage } from '@/services/facebook.service'
import { ConnectFacebookPageDialog } from '@/components/settings/ConnectFacebookPageDialog'
import type { FacebookPageConnection } from '@/services/facebook.service'

function getStatusInfo(page: FacebookPageConnection): { label: string; className: string } {
  if (page.status === 'ACTIVE') {
    return { label: 'Connected', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
  }
  return { label: 'Disconnected', className: 'bg-slate-50 text-slate-700 border-slate-200' }
}

export default function ChannelsPage(): React.JSX.Element {
  return (
    <QueryProvider>
      <ChannelsContent />
    </QueryProvider>
  )
}

function ChannelsContent(): React.JSX.Element {
  const [connectOpen, setConnectOpen] = useState(false)
  const queryClient = useQueryClient()

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ['facebookPages'],
    queryFn: getFacebookPages,
  })

  const disconnectMutation = useMutation({
    mutationFn: (pageId: string) => disconnectFacebookPage(pageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['facebookPages'] })
    },
  })

  async function handleDisconnect(page: FacebookPageConnection): Promise<void> {
    if (
      !confirm(
        `Disconnect "${page.displayName || page.externalId}"? Messenger conversations for this page will stop delivering until it's reconnected.`,
      )
    )
      return
    try {
      await disconnectMutation.mutateAsync(page.externalId)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to disconnect page')
    }
  }

  return (
    <main className="space-y-6 p-6 text-slate-950">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Channels</h1>
          <p className="mt-1 text-sm text-slate-600">
            Connect Facebook Pages so agents can reply to Messenger conversations from the unified
            inbox.
          </p>
        </div>
        <Button
          className="bg-slate-950 text-white hover:bg-slate-800"
          onClick={() => setConnectOpen(true)}
        >
          Connect Facebook Page
        </Button>
      </div>

      {isLoading && <TableSkeleton rows={3} columns={4} />}

      {error && (
        <ErrorState
          message={error instanceof Error ? error.message : 'Unable to load connected pages.'}
          onRetry={() => refetch()}
        />
      )}

      {!isLoading && !error && data && data.length === 0 && (
        <EmptyState
          icon={<Facebook className="h-6 w-6" />}
          title="No Facebook pages connected"
          description="Connect a Facebook page to start receiving Messenger conversations in the inbox."
          action={
            <Button
              className="bg-slate-950 text-white hover:bg-slate-800"
              onClick={() => setConnectOpen(true)}
            >
              Connect Facebook Page
            </Button>
          }
        />
      )}

      {!isLoading && !error && data && data.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="py-3 pr-4 pl-4 font-medium">Page</th>
                  <th className="py-3 pr-4 font-medium">Page ID</th>
                  <th className="py-3 pr-4 font-medium">Connected</th>
                  <th className="py-3 pr-4 font-medium">Status</th>
                  <th className="py-3 pr-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.map((page) => {
                  const status = getStatusInfo(page)
                  return (
                    <tr key={page.id} className="group hover:bg-slate-50">
                      <td className="py-3 pr-4 pl-4 font-medium text-slate-900">
                        <div className="flex items-center gap-2">
                          <Facebook className="h-4 w-4 text-blue-600" />
                          {page.displayName || 'Facebook Page'}
                        </div>
                      </td>
                      <td className="py-3 pr-4 font-mono text-xs text-slate-500">
                        {page.externalId}
                      </td>
                      <td className="py-3 pr-4 text-slate-600">
                        {new Date(page.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${status.className}`}
                        >
                          {status.label}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={page.status !== 'ACTIVE'}
                          onClick={() => handleDisconnect(page)}
                          className="text-red-600 hover:bg-red-50"
                        >
                          Disconnect
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ConnectFacebookPageDialog open={connectOpen} onOpenChange={setConnectOpen} />
    </main>
  )
}
