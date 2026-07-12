'use client'

import { useRef, useState } from 'react'
import { Send, Smile, Paperclip, FileImage } from 'lucide-react'
import { cn } from '@/lib/utils'

type MessageComposerProps = {
  onSend: (content: string) => Promise<void>
  disabled?: boolean
}

export function MessageComposer({
  onSend,
  disabled = false,
}: MessageComposerProps): React.JSX.Element {
  const [content, setContent] = useState('')
  const [sending, setSending] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  async function handleSend(): Promise<void> {
    const trimmed = content.trim()
    if (!trimmed || sending || disabled) return

    setSending(true)
    try {
      await onSend(trimmed)
      setContent('')
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
    } finally {
      setSending(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>): void {
    setContent(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }

  return (
    <div className="bg-white border-t border-slate-100 p-4 transition-all z-10">
      <div
        className={cn(
          'relative flex items-end gap-2 rounded-2xl bg-white p-2 transition-all duration-300 max-w-4xl mx-auto',
          isFocused
            ? 'shadow-md ring-2 ring-blue-500/20 border-blue-300'
            : 'shadow-sm border border-slate-200',
        )}
      >
        <div className="flex shrink-0 items-center gap-1 pb-1 pl-1">
          <button
            type="button"
            disabled={disabled}
            className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors disabled:opacity-50"
            title="Attach file"
          >
            <Paperclip className="h-5 w-5" />
          </button>
          <button
            type="button"
            disabled={disabled}
            className="hidden sm:block rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors disabled:opacity-50"
            title="Attach image"
          >
            <FileImage className="h-5 w-5" />
          </button>
        </div>

        <textarea
          ref={textareaRef}
          aria-label="Message content"
          placeholder="Type your message..."
          rows={1}
          value={content}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          disabled={disabled || sending}
          className="max-h-[120px] min-h-[24px] flex-1 resize-none bg-transparent py-2.5 px-2 text-[15px] text-slate-900 placeholder:text-slate-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        />

        <div className="flex shrink-0 items-center gap-2 pb-1 pr-1">
          <button
            type="button"
            disabled={disabled}
            className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-amber-500 transition-colors disabled:opacity-50"
            title="Insert emoji"
          >
            <Smile className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Send message"
            disabled={!content.trim() || sending || disabled}
            onClick={handleSend}
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all duration-300',
              content.trim() && !disabled && !sending
                ? 'bg-blue-600 text-white shadow-md hover:bg-blue-700 hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0'
                : 'bg-slate-100 text-slate-400 cursor-not-allowed',
            )}
          >
            {sending ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <Send className="h-4 w-4 ml-0.5" />
            )}
          </button>
        </div>
      </div>
      <div className="mt-2 text-center text-[11px] text-slate-400 font-medium">
        Press{' '}
        <kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-sans shadow-sm border border-slate-200">
          Enter
        </kbd>{' '}
        to send,{' '}
        <kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-sans shadow-sm border border-slate-200">
          Shift + Enter
        </kbd>{' '}
        for new line
      </div>
    </div>
  )
}
