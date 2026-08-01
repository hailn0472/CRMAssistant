'use client'

import { useCallback, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { getDealMentionCandidates } from '@/services/deal-comment.service'
import type { DealCommentUser } from '@/services/deal-comment.service'
import { insertMentionToken } from '@/lib/mention-parse'

type MentionInputProps = {
  dealId: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
}

type MentionAttempt = {
  start: number
  query: string
}

/**
 * Finds the `@` trigger for the current caret: the last `@` before the caret
 * with no whitespace between it and the caret. Returns null when there is no
 * in-progress mention attempt (which also closes the picker — typing a space
 * ends the attempt).
 */
function findMentionAttempt(text: string, caret: number): MentionAttempt | null {
  for (let i = caret - 1; i >= 0; i--) {
    const char = text[i]
    if (char === '@') {
      const query = text.slice(i + 1, caret)
      if (/\s/.test(query)) return null
      return { start: i, query }
    }
    if (char === ' ') return null
  }
  return null
}

/**
 * Textarea + inline mention picker (AC 43/52). Typing `@` opens the picker,
 * keystrokes after it filter via `dealMentionCandidates`, Up/Down move the
 * highlight, Enter/Tab insert `@[First Last](userId)` at the caret, Escape
 * closes the picker without closing the composer. There is no shared Combobox
 * component — this is the search-input + absolutely-positioned-dropdown idiom
 * from LineItemDialog. The listbox carries `role="listbox"` / `role="option"`
 * and `aria-activedescendant` on the textarea.
 */
export function MentionInput({
  dealId,
  value,
  onChange,
  disabled = false,
  placeholder = 'Write a comment...',
}: MentionInputProps): React.JSX.Element {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [mentionStart, setMentionStart] = useState(0)
  const [query, setQuery] = useState('')
  const [highlightIndex, setHighlightIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const caretRef = useRef(0)

  const { data: candidates = [] } = useQuery({
    queryKey: ['dealMentionCandidates', dealId, query],
    queryFn: () => getDealMentionCandidates(dealId, query || undefined),
    enabled: pickerOpen,
  })

  const closePicker = useCallback(() => {
    setPickerOpen(false)
    setHighlightIndex(0)
  }, [])

  const insertMention = useCallback(
    (user: DealCommentUser) => {
      const { text, caret } = insertMentionToken(value, mentionStart, caretRef.current, user)
      onChange(text)
      closePicker()
      requestAnimationFrame(() => {
        const textarea = textareaRef.current
        if (textarea) {
          textarea.focus()
          textarea.setSelectionRange(caret, caret)
        }
      })
    },
    [value, mentionStart, onChange, closePicker],
  )

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = event.target.value
      caretRef.current = event.target.selectionStart
      onChange(next)

      const attempt = findMentionAttempt(next, caretRef.current)
      if (attempt) {
        setMentionStart(attempt.start)
        setQuery(attempt.query)
        setPickerOpen(true)
        setHighlightIndex(0)
      } else {
        closePicker()
      }
    },
    [onChange, closePicker],
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!pickerOpen) return

      const optionCount = candidates.length
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (optionCount === 0) return
        event.preventDefault()
        const direction = event.key === 'ArrowDown' ? 1 : -1
        setHighlightIndex((current) => (current + direction + optionCount) % optionCount)
        return
      }

      if (event.key === 'Enter' || event.key === 'Tab') {
        if (optionCount === 0) return
        event.preventDefault()
        insertMention(candidates[highlightIndex] ?? candidates[0]!)
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        closePicker()
      }
    },
    [pickerOpen, candidates, highlightIndex, insertMention, closePicker],
  )

  const activeOptionId =
    pickerOpen && candidates.length > 0
      ? `mention-option-${candidates[highlightIndex % candidates.length]!.id}`
      : undefined

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={closePicker}
        disabled={disabled}
        rows={3}
        placeholder={placeholder}
        aria-label="Comment"
        role="combobox"
        aria-expanded={pickerOpen && candidates.length > 0}
        aria-haspopup="listbox"
        aria-controls="deal-comment-mention-listbox"
        aria-activedescendant={activeOptionId}
        className="w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:opacity-60"
      />

      {pickerOpen ? (
        <ul
          id="deal-comment-mention-listbox"
          role="listbox"
          aria-label="Mention someone"
          className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {candidates.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-500" role="presentation">
              No matching people
            </li>
          ) : (
            candidates.map((user, index) => (
              <li
                key={user.id}
                id={`mention-option-${user.id}`}
                role="option"
                aria-selected={index === highlightIndex}
                onMouseDown={(event) => {
                  // Keep focus in the textarea so the picker state stays consistent.
                  event.preventDefault()
                  insertMention(user)
                }}
                className={`flex items-baseline justify-between px-3 py-2 text-sm cursor-pointer ${
                  index === highlightIndex
                    ? 'bg-indigo-50 font-medium text-indigo-700'
                    : 'text-slate-700'
                }`}
              >
                <span>
                  {user.firstName} {user.lastName}
                </span>
                <span className="ml-2 text-xs text-slate-400">{user.email}</span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  )
}
