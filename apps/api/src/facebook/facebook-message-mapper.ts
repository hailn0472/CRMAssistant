import type { Message } from '@prisma/client'

import type { FacebookAttachment } from './facebook-message.types'
import type { FacebookMessagePayload } from './facebook-graph.client'

export type MappedInboundMessage = {
  content: string
  messageType: 'TEXT' | 'IMAGE' | 'VIDEO' | 'FILE'
  metadata?: Record<string, unknown>
}

function mapAttachmentType(type: string | undefined): 'IMAGE' | 'VIDEO' | 'FILE' {
  switch (type) {
    case 'image':
      return 'IMAGE'
    case 'video':
      return 'VIDEO'
    default:
      return 'FILE'
  }
}

/** Maps a Facebook inbound `messaging[].message` payload to our Message fields. */
export function mapInboundFacebookMessage(message: {
  mid?: string
  text?: string
  attachments?: FacebookAttachment[]
}): MappedInboundMessage {
  if (message.text) {
    return {
      content: message.text,
      messageType: 'TEXT',
      metadata: message.mid ? { mid: message.mid } : undefined,
    }
  }

  const attachments = message.attachments ?? []
  if (attachments.length > 0) {
    // Facebook can send more than one attachment in a single message. `Message`
    // only has one `content` string field, so we join every attachment's
    // url/placeholder into it rather than silently keeping only the first —
    // the full structured list is still preserved in `metadata.attachments`.
    const content = attachments
      .map((a) => {
        const url = a.payload?.url
        return typeof url === 'string' ? url : `[${a.type ?? 'unknown'} attachment]`
      })
      .join('\n')

    return {
      content,
      messageType: mapAttachmentType(attachments[0].type),
      metadata: { mid: message.mid, attachments: message.attachments },
    }
  }

  return {
    content: '[Unsupported Facebook message]',
    messageType: 'TEXT',
    metadata: message.mid ? { mid: message.mid } : undefined,
  }
}

/**
 * Maps an outbound (AGENT-sent) internal Message into a Facebook Graph API
 * `message` payload. Supports text, image/video/file attachments, quick
 * replies, and generic/button templates via `Message.metadata`.
 */
export function buildOutboundFacebookPayload(message: Message): FacebookMessagePayload {
  const metadata = (message.metadata as Record<string, unknown> | null) ?? {}
  const quickReplies = metadata['quickReplies'] as
    | Array<{ title: string; payload: string }>
    | undefined
  const template = metadata['template'] as Record<string, unknown> | undefined

  const payload: FacebookMessagePayload = {}

  switch (message.messageType) {
    case 'IMAGE':
      payload['attachment'] = {
        type: 'image',
        payload: { url: message.content, is_reusable: true },
      }
      break
    case 'VIDEO':
      payload['attachment'] = {
        type: 'video',
        payload: { url: message.content, is_reusable: true },
      }
      break
    case 'FILE':
      payload['attachment'] = { type: 'file', payload: { url: message.content, is_reusable: true } }
      break
    case 'TEMPLATE':
      if (template) {
        payload['attachment'] = { type: 'template', payload: template }
      } else {
        payload['text'] = message.content
      }
      break
    default:
      payload['text'] = message.content
  }

  if (quickReplies && quickReplies.length > 0) {
    payload['quick_replies'] = quickReplies.map((qr) => ({
      content_type: 'text',
      title: qr.title,
      payload: qr.payload,
    }))
  }

  return payload
}
