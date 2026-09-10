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
    <div className="flex gap-3 pb-[18px]">
      {/* Icon + connecting line */}
      <div className="flex flex-none flex-col items-center gap-[5px] pt-[3px]">
        <ActivityIcon type={type} size="sm" />
        {!isLast && (
          <div className="w-px flex-1 bg-[#ececf0]" aria-hidden="true" style={{ minHeight: 10 }} />
        )}
      </div>

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <div className="flex flex-wrap items-center gap-[9px]">
          <span className="text-[13.5px] font-medium text-[#1b1b1f]">{title}</span>
          {source !== null && (
            <span
              title={`Automatically logged from ${source}`}
              aria-label={`Automatically logged from ${source}`}
              className="rounded-[5px] bg-[#f4f4f6] px-[6px] py-px text-[10.5px] font-semibold text-[#6b6b76]"
            >
              Auto
            </span>
          )}
          <time
            className="ml-auto flex-none text-[11.5px] text-[#a0a0aa]"
            title={new Date(createdAt).toLocaleString()}
          >
            {relativeTime}
          </time>
        </div>

        {displayDescription && (
          <p className="text-[13px] leading-[1.55] text-[#4b4b55]">
            {displayDescription}
            {descriptionTruncated && (
              <button
                type="button"
                onClick={() => setShowFullDescription(true)}
                className="ml-1 text-[#4338ca] hover:underline"
              >
                Show more
              </button>
            )}
          </p>
        )}

        <span className="text-[11.5px] text-[#a0a0aa]">by {createdBy}</span>
      </div>
    </div>
  )
}
