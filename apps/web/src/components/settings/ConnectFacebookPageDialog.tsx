'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

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
import { connectFacebookPage } from '@/services/facebook.service'

interface ConnectFacebookPageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ConnectFacebookPageDialog({
  open,
  onOpenChange,
}: ConnectFacebookPageDialogProps): React.JSX.Element {
  const [pageId, setPageId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: () =>
      connectFacebookPage({
        pageId: pageId.trim(),
        accessToken: accessToken.trim(),
        displayName: displayName.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['facebookPages'] })
      handleClose()
    },
    onError: (err: Error) => {
      setError(err.message)
    },
  })

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    if (!pageId.trim()) {
      setError('Page ID is required')
      return
    }
    if (!accessToken.trim()) {
      setError('Access token is required')
      return
    }
    setError(null)
    mutation.mutate()
  }

  function handleClose(): void {
    setPageId('')
    setAccessToken('')
    setDisplayName('')
    setError(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect Facebook Page</DialogTitle>
          <DialogDescription>
            Link a Facebook page to receive and reply to Messenger conversations in the unified
            inbox. The access token is encrypted at rest and never shown again.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="fb-page-id" className="text-sm font-medium text-slate-700">
              Page ID
            </label>
            <Input
              id="fb-page-id"
              placeholder="e.g., 1234567890"
              value={pageId}
              onChange={(e) => setPageId(e.target.value)}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="fb-display-name" className="text-sm font-medium text-slate-700">
              Display Name <span className="text-xs text-slate-400">(optional)</span>
            </label>
            <Input
              id="fb-display-name"
              placeholder="e.g., Acme Support"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="fb-access-token" className="text-sm font-medium text-slate-700">
              Page Access Token
            </label>
            <Input
              id="fb-access-token"
              type="password"
              placeholder="EAAG..."
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
            />
          </div>
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
              {mutation.isPending ? 'Connecting...' : 'Connect Page'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
