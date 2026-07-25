/**
 * Loose types for Facebook's webhook/Graph API payloads — intentionally NOT
 * strict class-validator DTOs. The global ValidationPipe (`forbidNonWhitelisted:
 * true`) would strip/reject Facebook's payload shape if bound as a `@Body()` DTO,
 * so the webhook controller accepts `unknown` and this module validates
 * defensively at the field level instead.
 */

export type FacebookAttachment = {
  type?: string
  payload?: { url?: string; [key: string]: unknown }
}

export type FacebookReferral = { ref?: string; source?: string }

export type FacebookMessagingEvent = {
  sender?: { id?: string }
  recipient?: { id?: string }
  timestamp?: number
  message?: {
    mid?: string
    text?: string
    attachments?: FacebookAttachment[]
    // True when this event is Facebook echoing back one of our own outbound
    // sends on this page (rather than a genuine inbound customer message).
    is_echo?: boolean
    // Present when the customer arrived via an m.me link / ad referral and
    // this is their first message.
    referral?: FacebookReferral
  }
  // Delivery receipt for a batch of previously-sent page messages.
  delivery?: { mids?: string[]; watermark?: number }
  // Read receipt: all page messages sent up to `watermark` have been read.
  read?: { watermark?: number }
  // Customer tapped a quick-reply / persistent-menu / Get Started button.
  postback?: { title?: string; payload?: string }
  // Standalone referral event (e.g. customer opened an m.me link without a
  // "Get Started" button and hasn't sent a message yet).
  referral?: FacebookReferral
}

export type FacebookWebhookEntry = {
  id?: string // Facebook page id
  messaging?: FacebookMessagingEvent[]
}

export type FacebookWebhookBody = {
  object?: string
  entry?: FacebookWebhookEntry[]
}

// ── Graph API `GET /me/conversations` (history sync, Story 8A.4) ──────────
// `id` on a Graph history message IS the `mid` used for dedup elsewhere.

export type FacebookHistoryMessage = {
  id: string
  message?: string
  created_time: string
  from?: { id: string; name?: string }
  to?: { data: Array<{ id: string }> }
}

export type FacebookConversation = {
  id: string
  participants?: { data: Array<{ id: string; name?: string }> }
  messages?: { data: FacebookHistoryMessage[]; paging?: { next?: string } }
}

export type FacebookConversationsResponse = {
  data: FacebookConversation[]
  paging?: { cursors?: { after?: string }; next?: string }
}
