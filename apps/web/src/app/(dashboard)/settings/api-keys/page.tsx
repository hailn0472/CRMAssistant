'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import { WorkspaceHeader } from '@/components/layout/AppShell'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { TableSkeleton } from '@/components/shared/LoadingSkeleton'
import { QueryProvider } from '@/components/contacts/QueryProvider'
import { getApiKeys, revokeApiKey, rotateApiKey } from '@/services/api-key.service'
import { CreateApiKeyDialog } from '@/components/settings/CreateApiKeyDialog'
import type { ApiKey } from '@/services/api-key.service'

function getStatusInfo(key: ApiKey): { label: string; className: string } {
  if (key.isRevoked) return { label: 'Revoked', className: 'bg-red-50 text-red-700 border-red-200' }
  if (key.expiresAt && new Date(key.expiresAt) < new Date())
    return { label: 'Expired', className: 'bg-slate-50 text-slate-700 border-slate-200' }
  return { label: 'Active', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
}

export default function ApiKeysPage(): React.JSX.Element {
  return (
    <QueryProvider>
      <ApiKeysContent />
    </QueryProvider>
  )
}

function ApiKeysContent(): React.JSX.Element {
  const [createOpen, setCreateOpen] = useState(false)
  const [rotateResult, setRotateResult] = useState<{
    key: ApiKey
    fullKey: string
    keyPrefix: string
  } | null>(null)
  const queryClient = useQueryClient()

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ['apiKeys'],
    queryFn: getApiKeys,
  })

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeApiKey(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apiKeys'] })
    },
  })

  const rotateMutation = useMutation({
    mutationFn: (id: string) => rotateApiKey(id),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['apiKeys'] })
      setRotateResult({
        key: { id: result.id, name: '', keyPrefix: result.keyPrefix } as ApiKey,
        fullKey: result.fullKey,
        keyPrefix: result.keyPrefix,
      })
    },
  })

  async function handleRevoke(key: ApiKey): Promise<void> {
    if (
      !confirm(
        `Revoke API key "${key.name}"? This cannot be undone. Existing integrations using this key will stop working.`,
      )
    )
      return
    try {
      await revokeMutation.mutateAsync(key.id)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to revoke API key')
    }
  }

  async function handleRotate(key: ApiKey): Promise<void> {
    if (
      !confirm(
        `Rotate API key "${key.name}"? The old key will be revoked and a new one will be created.`,
      )
    )
      return
    try {
      await rotateMutation.mutateAsync(key.id)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to rotate API key')
    }
  }

  return (
    <main className="space-y-6 p-6 text-slate-950">
      <WorkspaceHeader
        eyebrow="Settings"
        title="API Keys"
        description="Manage API keys for third-party integrations."
        actions={
          <Button
            className="bg-slate-950 text-white hover:bg-slate-800"
            onClick={() => setCreateOpen(true)}
          >
            Create API Key
          </Button>
        }
      />

      {/* Rotate result dialog */}
      {rotateResult && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h3 className="mb-2 font-semibold text-amber-800">Key Rotated — New Key Shown Once</h3>
          <p className="mb-2 text-sm text-amber-700">
            The key &quot;{rotateResult.key.name}&quot; has been rotated. Copy the new key below.
          </p>
          <code className="block break-all rounded border border-amber-200 bg-white px-3 py-2 font-mono text-sm">
            {rotateResult.fullKey}
          </code>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => {
              navigator.clipboard.writeText(rotateResult.fullKey).catch(() => {})
            }}
          >
            Copy Key
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 ml-2"
            onClick={() => setRotateResult(null)}
          >
            Dismiss
          </Button>
        </div>
      )}

      {isLoading && <TableSkeleton rows={3} columns={5} />}

      {error && (
        <ErrorState
          message={error instanceof Error ? error.message : 'Unable to load API keys.'}
          onRetry={() => refetch()}
        />
      )}

      {!isLoading && !error && data && data.length === 0 && (
        <EmptyState
          title="No API keys yet"
          description="Create one to enable third-party integrations with your CRM data."
          action={
            <Button
              className="bg-slate-950 text-white hover:bg-slate-800"
              onClick={() => setCreateOpen(true)}
            >
              Create API Key
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
                  <th className="py-3 pr-4 pl-4 font-medium">Name</th>
                  <th className="py-3 pr-4 font-medium">Key Prefix</th>
                  <th className="py-3 pr-4 font-medium">Created</th>
                  <th className="py-3 pr-4 font-medium">Expires</th>
                  <th className="py-3 pr-4 font-medium">Last Used</th>
                  <th className="py-3 pr-4 font-medium">Status</th>
                  <th className="py-3 pr-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.map((key) => {
                  const status = getStatusInfo(key)
                  return (
                    <tr key={key.id} className="group hover:bg-slate-50">
                      <td className="py-3 pr-4 pl-4 font-medium text-slate-900">{key.name}</td>
                      <td className="py-3 pr-4 font-mono text-xs text-slate-500">
                        {key.keyPrefix}...
                      </td>
                      <td className="py-3 pr-4 text-slate-600">
                        {new Date(key.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-3 pr-4 text-slate-600">
                        {key.expiresAt ? new Date(key.expiresAt).toLocaleDateString() : '—'}
                      </td>
                      <td className="py-3 pr-4 text-slate-600">
                        {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : 'Never'}
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${status.className}`}
                        >
                          {status.label}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={key.isRevoked}
                            onClick={() => handleRevoke(key)}
                            className="text-red-600 hover:bg-red-50"
                          >
                            Revoke
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={key.isRevoked}
                            onClick={() => handleRotate(key)}
                          >
                            Rotate
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <CreateApiKeyDialog open={createOpen} onOpenChange={setCreateOpen} />
    </main>
  )
}
