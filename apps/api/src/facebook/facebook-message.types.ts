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

export type FacebookMessagingEvent = {
  sender?: { id?: string }
  recipient?: { id?: string }
  message?: {
    mid?: string
    text?: string
    attachments?: FacebookAttachment[]
    // True when this event is Facebook echoing back one of our own outbound
    // sends on this page (rather than a genuine inbound customer message).
    is_echo?: boolean
  }
}

export type FacebookWebhookEntry = {
  id?: string // Facebook page id
  messaging?: FacebookMessagingEvent[]
}

export type FacebookWebhookBody = {
  object?: string
  entry?: FacebookWebhookEntry[]
}
