'use client'

import { useRef, useState } from 'react'
import { Send, Smile, Paperclip, FileImage, MessageSquarePlus, X } from 'lucide-react'
import { cn } from '@/lib/utils'

type QuickReply = { title: string; payload: string }

type MessageComposerProps = {
  onSend: (content: string, options?: { metadata?: Record<string, unknown> }) => Promise<void>
  disabled?: boolean
  /** Active conversation channel — Facebook-specific composer options (quick replies,
   * templates) only render when this is 'FACEBOOK' (Story 8A.3, AC #13). */
  channel?: string
}

export function MessageComposer({
  onSend,
  disabled = false,
  channel,
}: MessageComposerProps): React.JSX.Element {
  const [content, setContent] = useState('')
  const [sending, setSending] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [showFacebookOptions, setShowFacebookOptions] = useState(false)
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([])
  const [quickReplyDraft, setQuickReplyDraft] = useState('')
  const [templateJson, setTemplateJson] = useState('')
  const [templateError, setTemplateError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const isFacebookConversation = channel === 'FACEBOOK'

  function addQuickReply(): void {
    const title = quickReplyDraft.trim()
    if (!title) return
    setQuickReplies((prev) => [
      ...prev,
      { title, payload: title.toUpperCase().replace(/\s+/g, '_') },
    ])
    setQuickReplyDraft('')
  }

  function removeQuickReply(index: number): void {
    setQuickReplies((prev) => prev.filter((_, i) => i !== index))
  }

  function buildMetadata(): Record<string, unknown> | undefined {
    const metadata: Record<string, unknown> = {}

    if (quickReplies.length > 0) {
      metadata['quickReplies'] = quickReplies
    }

    const trimmedTemplate = templateJson.trim()
    if (trimmedTemplate) {
      try {
        metadata['template'] = JSON.parse(trimmedTemplate)
        setTemplateError(null)
      } catch {
        setTemplateError('Template must be valid JSON')
        return undefined
      }
    }

    return Object.keys(metadata).length > 0 ? metadata : undefined
  }

  async function handleSend(): Promise<void> {
    const trimmed = content.trim()
    // Facebook's Send API requires non-empty text (or an attachment) whenever
    // quick_replies is present — a quick-reply-only send with empty text
    // would be rejected by the Graph API, so always require message text.
    if (!trimmed || sending || disabled) return

    const metadata = isFacebookConversation ? buildMetadata() : undefined
    if (isFacebookConversation && templateJson.trim() && !metadata) {
      // Invalid template JSON — surfaced via templateError, block send.
      return
    }

    setSending(true)
    try {
      await onSend(trimmed, metadata ? { metadata } : undefined)
      setContent('')
      setQuickReplies([])
      setTemplateJson('')
      setTemplateError(null)
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
      {isFacebookConversation && (
        <div className="mx-auto mb-2 max-w-4xl">
          <button
            type="button"
            onClick={() => setShowFacebookOptions((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold transition-colors',
              showFacebookOptions
                ? 'bg-blue-100 text-blue-700 border border-blue-200'
                : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50',
            )}
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            Facebook options
          </button>

          {showFacebookOptions && (
            <div className="mt-2 space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <div>
                <p className="mb-1.5 text-xs font-semibold text-slate-600">Quick replies</p>
                {quickReplies.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {quickReplies.map((qr, i) => (
                      <span
                        key={`${qr.payload}-${i}`}
                        className="flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700"
                      >
                        {qr.title}
                        <button
                          type="button"
                          aria-label={`Remove quick reply ${qr.title}`}
                          onClick={() => removeQuickReply(i)}
                          className="text-blue-500 hover:text-blue-800"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={quickReplyDraft}
                    onChange={(e) => setQuickReplyDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addQuickReply()
                      }
                    }}
                    placeholder="e.g., Yes please"
                    className="h-8 flex-1 rounded-full border border-slate-200 bg-white px-3 text-xs outline-none focus:border-blue-400"
                  />
                  <button
                    type="button"
                    onClick={addQuickReply}
                    className="rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800"
                  >
                    Add
                  </button>
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-xs font-semibold text-slate-600">
                  Template (button / generic — JSON)
                </p>
                <textarea
                  value={templateJson}
                  onChange={(e) => {
                    setTemplateJson(e.target.value)
                    setTemplateError(null)
                  }}
                  placeholder={'{"template_type":"button","text":"Choose an option","buttons":[]}'}
                  rows={2}
                  className="w-full rounded-lg border border-slate-200 bg-white p-2 font-mono text-xs outline-none focus:border-blue-400"
                />
                {templateError && <p className="mt-1 text-xs text-red-600">{templateError}</p>}
              </div>
            </div>
          )}
        </div>
      )}

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
