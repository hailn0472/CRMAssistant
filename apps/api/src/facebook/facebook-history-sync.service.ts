import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import type { ChannelConnection, ConversationStatus } from '@prisma/client'

import { PrismaService } from '../prisma/prisma.service'
import { ConversationsService } from '../inbox/conversations.service'
import { MessagesService } from '../inbox/messages.service'
import { decryptToken } from '../common/crypto/token-crypto'
import {
  FacebookCircuitOpenError,
  FacebookGraphClient,
  FacebookRateLimitError,
} from './facebook-graph.client'
import { FacebookService } from './facebook.service'
import { mapInboundFacebookMessage } from './facebook-message-mapper'
import type { FacebookConversation, FacebookHistoryMessage } from './facebook-message.types'
import { BACKGROUND_METRICS_PORT, type BackgroundMetricsPort } from '../observability/metrics.types'

const FACEBOOK_CHANNEL = 'FACEBOOK' as const
const SYSTEM_ACTOR = 'system'
// Hard caps so a misbehaving/looping Graph cursor can never spin forever — the
// rate limiter is a budget guard, not a loop guard. At MVP scale (a handful of
// pages, ~25 messages/page) these are far above any real conversation volume.
const MAX_CONVERSATION_PAGES = 1000
const MAX_MESSAGE_PAGES = 1000

type HistoryMessagePage = { data: FacebookHistoryMessage[]; paging?: { next?: string } }

function isPauseError(error: unknown): boolean {
  return error instanceof FacebookRateLimitError || error instanceof FacebookCircuitOpenError
}

/**
 * Pull-based backfill for Facebook Messenger conversations (Story 8A.4).
 * Complements the webhook pipeline (`FacebookService`) by pulling any
 * conversation history that arrived while the server was unavailable
 * (downtime, deploys, missed webhook deliveries).
 *
 * Depends on `FacebookService` (for `resolveOrCreateContactForPsid` +
 * `isDuplicateByMid`) but NOT vice versa — this keeps the module dependency
 * direction one-way, same as `FacebookService` itself. See `facebook.module.ts`
 * for how the one place a cycle could appear (the reconnect trigger) is
 * avoided by wiring it through the GraphQL resolver instead of inside
 * `FacebookService`.
 */
@Injectable()
export class FacebookHistorySyncService {
  private readonly logger = new Logger(FacebookHistorySyncService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly graphClient: FacebookGraphClient,
    private readonly facebookService: FacebookService,
    private readonly conversationsService: ConversationsService,
    private readonly messagesService: MessagesService,
    @Optional() @Inject(BACKGROUND_METRICS_PORT) private readonly metrics?: BackgroundMetricsPort,
  ) {}

  /** Syncs every ACTIVE Facebook connection across all tenants. Never throws
   * — called from application bootstrap, so one connection failing must never
   * block startup or abort syncing the others (AC #8). */
  async syncAllConnections(): Promise<void> {
    const connections = await this.prisma.channelConnection.findMany({
      where: { channel: FACEBOOK_CHANNEL, status: 'ACTIVE', deletedAt: null },
    })

    this.logger.log(`Facebook history sync: starting pass for ${connections.length} connection(s)`)

    for (const connection of connections) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await this.syncConnection(connection.id)
      } catch (error) {
        this.logger.error(
          `Facebook history sync failed for connection ${connection.id}`,
          error instanceof Error ? error.stack : String(error),
        )
      }
    }

    this.logger.log('Facebook history sync: pass complete')
  }

  /** Syncs a single connection. No-op if the connection is missing, not
   * Facebook, or not ACTIVE. Each conversation carries its own watermark, so a
   * failed thread never advances past another thread's unsynced messages. */
  async syncConnection(connectionId: string): Promise<void> {
    const startedAt = process.hrtime.bigint()
    let outcome: 'success' | 'error' = 'success'

    try {
      await this.syncConnectionInternal(connectionId)
    } catch (error) {
      outcome = 'error'
      throw error
    } finally {
      const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000
      this.recordSyncMetrics(outcome, durationSeconds)
    }
  }

  private recordSyncMetrics(outcome: 'success' | 'error', durationSeconds: number): void {
    const labels = { jobGroup: 'facebook_history_sync' as const, outcome }
    try {
      this.metrics?.recordJob(labels)
    } catch {
      // Telemetry must never alter a sync result.
    }
    try {
      this.metrics?.observeJobDuration(labels, durationSeconds)
    } catch {
      // Keep the counter and histogram independently best-effort.
    }
  }

  private async syncConnectionInternal(connectionId: string): Promise<void> {
    const connection = await this.prisma.channelConnection.findUnique({
      where: { id: connectionId },
    })
    if (!connection || connection.channel !== FACEBOOK_CHANNEL || connection.status !== 'ACTIVE') {
      return
    }

    const pageAccessToken = decryptToken(connection.accessTokenEncrypted)
    const pageId = connection.externalId
    // Captured before the first Graph call — using pass-start time (not
    // Date.now() after, not max created_time) guarantees a message that lands
    // mid-pass is never skipped: it'll be > passStartedAt next time. The
    // mid-dedup guard makes the resulting small overlap harmless.
    const passStartedAt = new Date()

    let after: string | undefined
    let paused = false
    const seenCursors = new Set<string>()
    let pages = 0

    do {
      let page
      try {
        // eslint-disable-next-line no-await-in-loop
        page = await this.graphClient.getConversations(pageAccessToken, { after })
      } catch (error) {
        if (isPauseError(error)) {
          this.logger.warn(
            `Facebook history sync paused for connection ${connectionId}: ${(error as Error).message}`,
          )
          paused = true
          break
        }
        throw error
      }

      for (const conversation of page.data) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const conversationPaused = await this.syncConversation(
            connection,
            pageId,
            pageAccessToken,
            conversation,
            passStartedAt,
          )
          if (conversationPaused) {
            paused = true
            break
          }
        } catch (error) {
          // Per-conversation isolation: a failed thread simply keeps its own
          // watermark (not advanced), so it is retried on the next pass — one
          // bad thread never blocks or skips the others.
          this.logger.error(
            `Facebook history sync failed for conversation ${conversation.id} (connection ${connectionId})`,
            error instanceof Error ? error.stack : String(error),
          )
        }
      }

      if (paused) break

      after = page.paging?.cursors?.after
      if (after) {
        if (seenCursors.has(after) || pages >= MAX_CONVERSATION_PAGES) {
          this.logger.warn(
            `Facebook history sync: stopping outer pagination for connection ${connectionId} (repeated cursor or page cap)`,
          )
          break
        }
        seenCursors.add(after)
        pages += 1
      }
    } while (after)

    // Connection-level watermark is now only a coarse "last clean full pass"
    // marker for observability — the per-conversation watermark is the actual
    // dedup/skip filter. Advance it only when the whole pass completed without
    // a rate-limit/circuit-open pause.
    if (!paused) {
      await this.prisma.channelConnection.update({
        where: { id: connectionId },
        data: { lastSyncedAt: passStartedAt },
      })
    }
  }

  /** Syncs a single conversation end-to-end: resolves the 1:1 customer up front
   * (needed to read/advance the per-conversation watermark), then drains the
   * nested `messages` pagination (newest first) until the watermark rejects a
   * message or the pages run out. Advances the conversation's own watermark only
   * after a clean drain (no pause, no persist failure). Returns `true` if a
   * rate-limit/circuit-open pause interrupted the drain. */
  private async syncConversation(
    connection: ChannelConnection,
    pageId: string,
    pageAccessToken: string,
    conversation: FacebookConversation,
    passStartedAt: Date,
  ): Promise<boolean> {
    const customerParticipant = conversation.participants?.data.find((p) => p.id !== pageId)
    const customerPsid = customerParticipant?.id ?? this.deriveCustomerPsid(conversation, pageId)
    if (!customerPsid) {
      this.logger.warn(
        `Facebook history sync: could not resolve customer PSID for conversation ${conversation.id}`,
      )
      return false
    }

    const [firstName, ...rest] = (customerParticipant?.name ?? '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
    const profileName = firstName ? { firstName, lastName: rest.join(' ') || undefined } : undefined

    const contactId = await this.facebookService.resolveOrCreateContactForPsid(
      connection.tenantId,
      customerPsid,
      connection.id,
      profileName,
    )

    const convo = await this.conversationsService.findOrCreateConversation(
      connection.tenantId,
      contactId,
      FACEBOOK_CHANNEL,
      SYSTEM_ACTOR,
    )

    const watermark = convo.lastSyncedAt
    // Reopen is deferred into the persist path (only when a genuinely new,
    // non-duplicate message arrives) so an all-duplicate re-sync never
    // resurrects a thread an agent deliberately resolved.
    let conversationStatus: ConversationStatus = convo.status
    let hadFailure = false

    let page: HistoryMessagePage | undefined = conversation.messages
    let nextUrl = page?.paging?.next
    const seenUrls = new Set<string>()
    let drainedPages = 0

    while (page) {
      let stopDraining = false

      for (const message of page.data) {
        const createdTime = new Date(message.created_time)
        if (Number.isNaN(createdTime.getTime())) {
          // A malformed timestamp must not disable the watermark stop condition
          // (Invalid Date comparisons are always false). Skip it defensively.
          this.logger.warn(
            `Facebook history sync: skipping message ${message.id} with invalid created_time in conversation ${conversation.id}`,
          )
          continue
        }
        // Messages come back newest-first — once one is at/under the watermark,
        // the rest of this page (and any older pages) are stale too.
        if (watermark && createdTime <= watermark) {
          stopDraining = true
          break
        }

        try {
          // eslint-disable-next-line no-await-in-loop
          conversationStatus = await this.persistHistoryMessage(
            connection,
            pageId,
            convo.id,
            contactId,
            conversationStatus,
            message,
            createdTime,
          )
        } catch (error) {
          // One un-persistable message must not abort the conversation, but it
          // must prevent advancing the watermark so it is retried next pass.
          this.logger.error(
            `Facebook history sync: failed to persist message ${message.id} (conversation ${conversation.id})`,
            error instanceof Error ? error.stack : String(error),
          )
          hadFailure = true
        }
      }

      if (stopDraining || !nextUrl) break
      if (seenUrls.has(nextUrl) || drainedPages >= MAX_MESSAGE_PAGES) {
        this.logger.warn(
          `Facebook history sync: stopping nested pagination for conversation ${conversation.id} (repeated page URL or page cap)`,
        )
        break
      }
      seenUrls.add(nextUrl)
      drainedPages += 1

      try {
        // eslint-disable-next-line no-await-in-loop
        page = await this.graphClient.getPageByUrl<HistoryMessagePage>(nextUrl, pageAccessToken)
      } catch (error) {
        if (isPauseError(error)) {
          this.logger.warn(
            `Facebook history sync paused mid-conversation ${conversation.id}: ${(error as Error).message}`,
          )
          return true
        }
        throw error
      }
      nextUrl = page.paging?.next
    }

    // Advance this conversation's own watermark only after a clean drain — a
    // per-message persist failure leaves the old mark so it is retried.
    if (!hadFailure) {
      await this.prisma.conversation.update({
        where: { id: convo.id },
        data: { lastSyncedAt: passStartedAt },
      })
    }

    return false
  }

  /** Persists one history message. Deduped by `mid` BEFORE any thread reopen so
   * a repeat sync of an already-persisted (agent-resolved) thread never
   * resurrects it. Returns the (possibly updated) conversation status so the
   * caller reopens at most once per thread. Throws on persist failure so the
   * caller can withhold the watermark advance. */
  private async persistHistoryMessage(
    connection: ChannelConnection,
    pageId: string,
    conversationId: string,
    contactId: string,
    conversationStatus: ConversationStatus,
    message: FacebookHistoryMessage,
    createdTime: Date,
  ): Promise<ConversationStatus> {
    if (await this.facebookService.isDuplicateByMid(conversationId, message.id)) {
      return conversationStatus
    }

    let status = conversationStatus
    // `findOrCreateConversation` already reopened ARCHIVED → OPEN; only RESOLVED
    // reaches here. Reopen lazily (mirrors the inbound webhook convention) so no
    // historical customer message is dropped, but only for a real new message.
    if (status === 'RESOLVED') {
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { status: 'OPEN', updatedBy: SYSTEM_ACTOR },
      })
      status = 'OPEN'
    }

    const senderType: 'AGENT' | 'CONTACT' = message.from?.id === pageId ? 'AGENT' : 'CONTACT'
    const { content, messageType, metadata } = mapInboundFacebookMessage({
      mid: message.id,
      text: message.message,
    })

    await this.messagesService.sendMessage(connection.tenantId, {
      conversationId,
      senderId: senderType === 'AGENT' ? connection.id : contactId,
      senderType,
      content,
      messageType,
      metadata: { ...metadata, source: 'facebook_history_sync' },
      // Preserve the real timestamp so history renders chronologically (D1).
      sentAt: createdTime,
      // Mandatory (AC #5) — historical AGENT messages were already delivered to
      // the customer; re-dispatching would re-send them.
      skipDispatch: true,
    })

    return status
  }

  /** Fallback customer-PSID resolver when `participants` is absent: the first
   * non-page id referenced by any message's `from`/`to`. */
  private deriveCustomerPsid(
    conversation: FacebookConversation,
    pageId: string,
  ): string | undefined {
    for (const message of conversation.messages?.data ?? []) {
      if (message.from?.id && message.from.id !== pageId) {
        return message.from.id
      }
      const recipient = message.to?.data.find((t) => t.id !== pageId)
      if (recipient?.id) {
        return recipient.id
      }
    }
    return undefined
  }
}
