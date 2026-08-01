'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'

import {
  getDealComments,
  addDealComment,
  deleteDealComment,
  ON_DEAL_COMMENT_ADDED_SUBSCRIPTION,
} from '@/services/deal-comment.service'
import type { DealComment } from '@/services/deal-comment.service'
import { GraphqlSubscriptionClient } from '@/lib/graphql-subscription'
import { parseCommentSegments } from '@/lib/mention-parse'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton'
import { Button } from '@/components/ui/button'
import { usePermission } from '@/hooks/usePermission'
import { useAuthStore } from '@/stores/auth.store'
import { MentionInput } from './MentionInput'

/**
 * Deal comment thread + composer (AC 42/43/47). The thread renders oldest-first
 * with author name, avatar initial, relative timestamp and a delete affordance
 * shown only for the caller's own comments. New comments arrive over
 * ON_DEAL_COMMENT_ADDED_SUBSCRIPTION and are merged by invalidating
 * ['dealComments', dealId]. The subscription uses the connectGuardRef
 * double-connect guard (StrictMode-safe) and disconnects on unmount.
 *
 * Comment text is rendered as plain text with mention tokens replaced by styled
 * spans — never as HTML (AC 26).
 */
export function DealComments({ dealId }: { dealId: string }): React.JSX.Element {
  const queryClient = useQueryClient()
  const currentUserId = useAuthStore((state) => state.user?.userId)
  const canComment = usePermission('DEAL', 'UPDATE')
  const [draft, setDraft] = useState('')

  const clientRef = useRef<GraphqlSubscriptionClient | null>(null)
  const connectGuardRef = useRef(false)

  const {
    data: connection,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['dealComments', dealId],
    queryFn: () => getDealComments(dealId),
  })

  const handleNewComment = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['dealComments', dealId] })
  }, [queryClient, dealId])

  // Real-time subscription — connectGuardRef prevents the React StrictMode
  // double-connect; the client is always disconnected on unmount.
  useEffect(() => {
    if (connectGuardRef.current) return
    connectGuardRef.current = true

    const client = new GraphqlSubscriptionClient()
    clientRef.current = client

    client.connect()

    client.subscribe('onDealCommentAdded', {
      query: ON_DEAL_COMMENT_ADDED_SUBSCRIPTION,
      variables: { dealId },
      onData: handleNewComment,
    })

    return () => {
      connectGuardRef.current = false
      client.disconnect()
      clientRef.current = null
    }
  }, [dealId, handleNewComment])

  const addMutation = useMutation({
    mutationFn: (comment: string) => addDealComment(dealId, comment),
    onSuccess: () => {
      setDraft('')
      queryClient.invalidateQueries({ queryKey: ['dealComments', dealId] })
      toast.success('Comment added')
    },
    onError: () => {
      toast.error('Failed to post comment')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDealComment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dealComments', dealId] })
      toast.success('Comment deleted')
    },
    onError: () => {
      toast.error('Failed to delete comment')
    },
  })

  const handleDelete = (comment: DealComment): void => {
    if (!confirm('Delete this comment?')) return
    deleteMutation.mutate(comment.id)
  }

  const handleSubmit = (): void => {
    const trimmed = draft.trim()
    if (!trimmed || addMutation.isPending) return
    addMutation.mutate(trimmed)
  }

  if (isLoading) return <LoadingSkeleton />

  const comments = connection?.items ?? []

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Comments</h3>

      {error ? (
        <ErrorState message="Failed to load comments" />
      ) : comments.length === 0 ? (
        <EmptyState
          title="No comments yet"
          description="Discuss this deal with your team. Use @ to mention a colleague."
        />
      ) : (
        <ul className="space-y-4">
          {comments.map((comment) => (
            <li key={comment.id} className="flex gap-3">
              <div
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700"
              >
                {(
                  comment.author.firstName.charAt(0) + comment.author.lastName.charAt(0)
                ).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-slate-900">
                    {comment.author.firstName} {comment.author.lastName}
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      {formatRelativeTime(comment.createdAt)}
                    </span>
                  </p>
                  {comment.userId === currentUserId ? (
                    <button
                      type="button"
                      aria-label={`Delete your comment`}
                      onClick={() => handleDelete(comment)}
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
                  {parseCommentSegments(comment.comment, comment.mentionedUsers).map(
                    (segment, index) =>
                      segment.type === 'mention' ? (
                        <span
                          key={index}
                          className="rounded bg-indigo-50 px-1 font-medium text-indigo-600"
                        >
                          {segment.text}
                        </span>
                      ) : (
                        <span key={index}>{segment.text}</span>
                      ),
                  )}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {canComment ? (
        <div className="space-y-2 border-t border-slate-100 pt-4">
          <MentionInput
            dealId={dealId}
            value={draft}
            onChange={setDraft}
            disabled={addMutation.isPending}
          />
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              onClick={handleSubmit}
              disabled={addMutation.isPending || draft.trim().length === 0}
            >
              {addMutation.isPending ? 'Posting...' : 'Comment'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}
