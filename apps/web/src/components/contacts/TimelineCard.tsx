'use client'

import { useState } from 'react'
import { ActivityIcon } from './ActivityIcon'
import type { ActivityTypeValue } from '@/types/activity.types'

type TimelineCardProps = {
  type: ActivityTypeValue
  title: string
  description: string | null
  createdAt: string
  createdBy: string
  isLast?: boolean
  // Story 4.2 (AC 48): non-null means the row was auto-logged from an
  // integrated channel — renders the "Auto" badge. Never signal by colour
  // alone (WCAG AA); the badge pairs colour with a text label.
  source?: string | null
}

const MAX_DESC_LENGTH = 200

function formatRelativeTime(dateStr: string): string {
  const now = Date.now()
  const date = new Date(dateStr).getTime()
  const diffMs = now - date

  // Handle future dates — show the date instead of a negative relative time
  if (diffMs < 0) {
    return new Date(dateStr).toLocaleDateString()
  }

  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSeconds < 60) return 'just now'
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`
  return new Date(dateStr).toLocaleDateString()
}

export function TimelineCard({
  type,
  title,
  description,
  createdAt,
  createdBy,
  isLast = false,
  source = null,
}: TimelineCardProps): React.JSX.Element {
  const [showFullDescription, setShowFullDescription] = useState(false)

  const relativeTime = (() => {
    try {
      return formatRelativeTime(createdAt)
    } catch {
      return createdAt
    }
  })()

  const descriptionTruncated =
    description && description.length > MAX_DESC_LENGTH && !showFullDescription
  const displayDescription = descriptionTruncated
    ? description.slice(0, MAX_DESC_LENGTH) + '...'
    : description

  return (
    <div className="relative flex gap-4 pb-6">
      {/* Timeline line */}
      {!isLast && (
        <div className="absolute left-5 top-10 bottom-0 w-0.5 bg-slate-200" aria-hidden="true" />
      )}

      {/* Icon */}
      <div className="relative z-10 flex-shrink-0">
        <ActivityIcon type={type} size="sm" />
      </div>

      {/* Content card */}
      <div className="flex-1 rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
          <time
            className="flex-shrink-0 text-xs text-slate-400"
            title={new Date(createdAt).toLocaleString()}
          >
            {relativeTime}
          </time>
        </div>

        {source !== null && (
          <span
            title={`Automatically logged from ${source}`}
            aria-label={`Automatically logged from ${source}`}
            className="mt-1 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500"
          >
            Auto
          </span>
        )}

        {displayDescription && (
          <p className="mt-1 text-sm text-slate-600">
            {displayDescription}
            {descriptionTruncated && (
              <button
                type="button"
                onClick={() => setShowFullDescription(true)}
                className="ml-1 text-blue-600 hover:text-blue-700"
              >
                Show more
              </button>
            )}
          </p>
        )}

        <p className="mt-1 text-xs text-slate-400">by {createdBy}</p>
      </div>
    </div>
  )
}
