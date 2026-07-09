'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { createApiKey } from '@/services/api-key.service'
import { getMyPermissions } from '@/services/permission.service'
import type { CreateApiKeyResult } from '@/services/api-key.service'

interface CreateApiKeyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CreateApiKeyDialog({
  open,
  onOpenChange,
}: CreateApiKeyDialogProps): React.JSX.Element {
  const [createdKey, setCreatedKey] = useState<CreateApiKeyResult | null>(null)
  const [name, setName] = useState('')
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const queryClient = useQueryClient()

  const { data: myPermissions } = useQuery({
    queryKey: ['myPermissions'],
    queryFn: getMyPermissions,
    enabled: open,
  })

  const grantedPermissions = myPermissions?.filter((p) => p.granted) ?? []

  function togglePermission(perm: string): void {
    setSelectedPermissions((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm],
    )
  }

  const mutation = useMutation({
    mutationFn: () =>
      createApiKey({
        name,
        permissions: selectedPermissions.length > 0 ? selectedPermissions : undefined,
      }),
    onSuccess: (result) => {
      setCreatedKey(result)
      setError(null)
    },
    onError: (err: Error) => {
      setError(err.message)
    },
  })

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    setError(null)
    mutation.mutate()
  }

  async function handleCopy(): Promise<void> {
    if (!createdKey) return
    try {
      await navigator.clipboard.writeText(createdKey.fullKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback
    }
  }

  function handleSaved(): void {
    queryClient.invalidateQueries({ queryKey: ['apiKeys'] })
    setTimeout(() => {
      setCreatedKey(null)
      setCopied(false)
      setName('')
      setError(null)
      onOpenChange(false)
    }, 500)
  }

  function handleClose(): void {
    setCreatedKey(null)
    setCopied(false)
    setName('')
    setError(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        {!createdKey ? (
          <>
            <DialogHeader>
              <DialogTitle>Create API Key</DialogTitle>
              <DialogDescription>
                Create a new API key for third-party integrations. The full key will be shown only
                once.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="api-key-name" className="text-sm font-medium text-slate-700">
                  Key Name
                </label>
                <Input
                  id="api-key-name"
                  placeholder="e.g., Production Integration"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </div>
              {grantedPermissions.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-slate-700">
                    Permission Scoping <span className="text-xs text-slate-400">(optional)</span>
                  </span>
                  <div className="max-h-40 overflow-y-auto rounded-md border border-slate-200 p-2">
                    {grantedPermissions.map((perm) => {
                      const permKey = `${perm.resource}:${perm.action}`
                      return (
                        <label
                          key={permKey}
                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50"
                        >
                          <input
                            type="checkbox"
                            checked={selectedPermissions.includes(permKey)}
                            onChange={() => togglePermission(permKey)}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                          <span className="text-slate-700">
                            {perm.resource}:{perm.action}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                  <p className="text-xs text-slate-400">
                    Leave empty to grant full access (matching your permissions).
                  </p>
                </div>
              )}
              {error && <p className="text-sm text-red-600">{error}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-slate-950 text-white hover:bg-slate-800"
                  disabled={mutation.isPending}
                >
                  {mutation.isPending ? 'Creating...' : 'Create Key'}
                </Button>
              </DialogFooter>
            </form>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>API Key Created</DialogTitle>
              <DialogDescription>
                Copy this key now. You won&apos;t be able to see it again.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="rounded-lg bg-slate-50 p-4">
                <p className="mb-1 text-xs font-medium text-slate-500">Your API Key</p>
                <code className="block break-all rounded border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900">
                  {createdKey.fullKey}
                </code>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={handleCopy}>
                  {copied ? 'Copied!' : 'Copy to Clipboard'}
                </Button>
                <Button
                  className="flex-1 bg-slate-950 text-white hover:bg-slate-800"
                  onClick={handleSaved}
                >
                  I&apos;ve Saved the Key
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
