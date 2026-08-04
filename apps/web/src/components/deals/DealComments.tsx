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
import { ErrorState } from '@/components/shared/ErrorState'
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton'
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
    <div className="flex flex-col gap-3.5 px-[18px] pt-[14px] pb-[18px]">
      {error ? (
        <ErrorState message="Failed to load comments" />
      ) : (
        comments.map((comment) => (
          <div key={comment.id} className="flex gap-[11px]">
            <span className="flex h-[28px] w-[28px] flex-none items-center justify-center rounded-full bg-[#f0f0f3] text-[10.5px] font-semibold text-[#4b4b55]">
              {(
                comment.author.firstName.charAt(0) + comment.author.lastName.charAt(0)
              ).toUpperCase()}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-[#1b1b1f]">
                    {comment.author.firstName} {comment.author.lastName}
                  </span>
                  <span className="text-[11.5px] text-[#a0a0aa]">
                    {formatRelativeTime(comment.createdAt)}
                  </span>
                </div>
                {comment.userId === currentUserId ? (
                  <button
                    type="button"
                    aria-label="Delete your comment"
                    onClick={() => handleDelete(comment)}
                    className="text-[#a0a0aa] transition-colors hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
              <p className="m-0 text-[13px] leading-[1.55] text-[#4b4b55]">
                {parseCommentSegments(comment.comment, comment.mentionedUsers).map(
                  (segment, index) =>
                    segment.type === 'mention' ? (
                      <span
                        key={index}
                        className="rounded bg-[#f0f0f3] px-1 font-medium text-[#1b1b1f]"
                      >
                        {segment.text}
                      </span>
                    ) : (
                      <span key={index}>{segment.text}</span>
                    ),
                )}
              </p>
            </div>
          </div>
        ))
      )}

      {canComment ? (
        <div className="flex flex-col gap-2 rounded-[11px] border border-[#e6e6eb] bg-[#fafafb] p-[10px_12px] transition-colors focus-within:border-[#1b1b1f] focus-within:bg-white">
          <MentionInput
            dealId={dealId}
            value={draft}
            onChange={setDraft}
            disabled={addMutation.isPending}
            placeholder="Add a comment for your team…"
            rows={2}
            className="w-full resize-none border-none bg-transparent p-0 text-[13px] text-[#1b1b1f] outline-none placeholder:text-[#a0a0aa]"
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={addMutation.isPending || draft.trim().length === 0}
            className="self-end h-8 px-3.5 rounded-[9px] border border-[#1b1b1f] bg-[#1b1b1f] text-white text-[12.5px] font-semibold transition-colors hover:bg-black disabled:opacity-50"
          >
            {addMutation.isPending ? 'Posting...' : 'Comment'}
          </button>
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
