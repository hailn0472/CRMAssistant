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
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 rounded-[11px] border border-[#e6e6eb] bg-[#fafafb] p-3 transition-colors focus-within:border-[#1b1b1f] focus-within:bg-white"
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Add a note... (Ctrl+Enter to submit)"
        className="w-full resize-none border-none bg-transparent text-[13px] text-[#1b1b1f] outline-none placeholder:text-[#a0a0aa]"
        rows={3}
        maxLength={MAX_NOTE_LENGTH + 50}
        disabled={isSubmitting}
        aria-label="Note text"
      />

      <div className="flex items-center justify-between">
        <span
          className={`text-[11.5px] ${
            isOverLimit
              ? 'font-semibold text-[#b91c1c]'
              : isNearLimit
                ? 'text-[#c2860a]'
                : 'text-[#a0a0aa]'
          }`}
        >
          {charCount}/{MAX_NOTE_LENGTH}
        </span>

        <button
          type="submit"
          disabled={!isValid || isSubmitting}
          className="inline-flex h-8 items-center rounded-[9px] border border-[#1b1b1f] bg-[#1b1b1f] px-3.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? 'Saving...' : 'Save'}
        </button>
      </div>
    </form>
  )
}
