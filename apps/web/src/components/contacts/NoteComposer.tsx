'use client'

import { useState, useCallback } from 'react'

const MAX_NOTE_LENGTH = 1000
const WARN_AT_LENGTH = 900

type NoteComposerProps = {
  onSubmit: (text: string) => Promise<void> | void
  isSubmitting?: boolean
}

export function NoteComposer({
  onSubmit,
  isSubmitting = false,
}: NoteComposerProps): React.JSX.Element {
  const [text, setText] = useState('')

  const charCount = text.length
  const isOverLimit = charCount > MAX_NOTE_LENGTH
  const isNearLimit = charCount >= WARN_AT_LENGTH
  const isValid = charCount > 0 && charCount <= MAX_NOTE_LENGTH

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!isValid || isSubmitting) return
      await onSubmit(text)
      setText('')
    },
    [text, isValid, isSubmitting, onSubmit],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        if (isValid && !isSubmitting) {
          onSubmit(text)
          setText('')
        }
      }
    },
    [text, isValid, isSubmitting, onSubmit],
  )

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-slate-200 bg-white p-4">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Add a note... (Ctrl+Enter to submit)"
        className="w-full resize-none rounded-md border border-slate-200 p-3 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        rows={3}
        maxLength={MAX_NOTE_LENGTH + 50}
        disabled={isSubmitting}
        aria-label="Note text"
      />

      <div className="mt-2 flex items-center justify-between">
        <span
          className={`text-xs ${
            isOverLimit
              ? 'text-red-600 font-semibold'
              : isNearLimit
                ? 'text-amber-600'
                : 'text-slate-400'
          }`}
        >
          {charCount}/{MAX_NOTE_LENGTH}
        </span>

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={!isValid || isSubmitting}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </form>
  )
}
