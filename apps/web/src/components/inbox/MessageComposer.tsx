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
    <div className="bg-white p-4">
      {isFacebookConversation && (
        <div className="mx-auto mb-2 max-w-4xl">
          <button
            type="button"
            onClick={() => setShowFacebookOptions((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold transition-colors',
              showFacebookOptions
                ? 'bg-[#f4f4f6] text-[#1b1b1f] border border-[#e6e6eb]'
                : 'text-[#a0a0aa] hover:text-[#4b4b55] hover:bg-[#fafafb]',
            )}
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            Facebook options
          </button>

          {showFacebookOptions && (
            <div className="mt-2 space-y-3 rounded-[11px] border border-[#e6e6eb] bg-[#fafafb] p-3">
              <div>
                <p className="mb-1.5 text-xs font-semibold text-[#4b4b55]">Quick replies</p>
                {quickReplies.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {quickReplies.map((qr, i) => (
                      <span
                        key={`${qr.payload}-${i}`}
                        className="flex items-center gap-1 rounded-full border border-[#e6e6eb] bg-white px-2.5 py-0.5 text-xs font-medium text-[#1b1b1f]"
                      >
                        {qr.title}
                        <button
                          type="button"
                          aria-label={`Remove quick reply ${qr.title}`}
                          onClick={() => removeQuickReply(i)}
                          className="text-[#8c8c96] hover:text-[#1b1b1f]"
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
                    className="h-8 flex-1 rounded-full border border-[#e6e6eb] bg-white px-3 text-xs outline-none focus:border-[#1b1b1f]"
                  />
                  <button
                    type="button"
                    onClick={addQuickReply}
                    className="rounded-full bg-[#1b1b1f] px-3 py-1 text-xs font-medium text-white hover:bg-black"
                  >
                    Add
                  </button>
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-xs font-semibold text-[#4b4b55]">
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
                  className="w-full rounded-lg border border-[#e6e6eb] bg-white p-2 font-mono text-xs outline-none focus:border-[#1b1b1f]"
                />
                {templateError && <p className="mt-1 text-xs text-[#b91c1c]">{templateError}</p>}
              </div>
            </div>
          )}
        </div>
      )}

      <div
        className={cn(
          'relative flex items-end gap-2 rounded-[11px] bg-white p-2 max-w-4xl mx-auto border transition-colors',
          isFocused ? 'border-[#1b1b1f]' : 'border-[#e6e6eb]',
        )}
      >
        <div className="flex shrink-0 items-center gap-1 pb-1 pl-1">
          <button
            type="button"
            disabled={disabled}
            className="rounded-[7px] p-2 text-[#6b6b76] hover:bg-[#f4f4f6] transition-colors disabled:opacity-50"
            title="Attach file"
          >
            <Paperclip className="h-5 w-5" />
          </button>
          <button
            type="button"
            disabled={disabled}
            className="hidden sm:block rounded-[7px] p-2 text-[#6b6b76] hover:bg-[#f4f4f6] transition-colors disabled:opacity-50"
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
          className="max-h-[120px] min-h-[24px] flex-1 resize-none bg-transparent py-2.5 px-2 text-[13.5px] text-[#1b1b1f] placeholder:text-[#a0a0aa] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        />

        <div className="flex shrink-0 items-center gap-2 pb-1 pr-1">
          <button
            type="button"
            disabled={disabled}
            className="rounded-[7px] p-2 text-[#6b6b76] hover:bg-[#f4f4f6] transition-colors disabled:opacity-50"
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
              'flex h-9 items-center gap-1.5 rounded-[9px] px-3.5 text-[12.5px] font-semibold transition-colors',
              content.trim() && !disabled && !sending
                ? 'border border-[#1b1b1f] bg-[#1b1b1f] text-white hover:bg-black'
                : 'border border-[#e6e6eb] bg-[#fafafb] text-[#a0a0aa] cursor-not-allowed',
            )}
          >
            {sending ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {sending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
      <div className="mt-2 text-center text-[11px] text-[#a0a0aa]">
        Enter to send · Shift+Enter for a new line
      </div>
    </div>
  )
}
