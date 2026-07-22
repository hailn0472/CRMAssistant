import { Injectable } from '@nestjs/common'
import type { Conversation, Message, Prisma } from '@prisma/client'

import { PrismaService } from '../prisma/prisma.service'
import type { ChannelDispatcher } from '../inbox/channel-dispatcher'
import { decryptToken } from '../common/crypto/token-crypto'
import { FacebookGraphClient } from './facebook-graph.client'
import { buildOutboundFacebookPayload } from './facebook-message-mapper'

const FACEBOOK_CHANNEL = 'FACEBOOK' as const

/**
 * Delivers AGENT-sent messages on FACEBOOK conversations to the Facebook Graph
 * API. Bound to `CHANNEL_DISPATCHER` in `FacebookModule` — see
 * `inbox/channel-dispatcher.ts` for why this indirection exists (keeps
 * InboxModule from ever importing FacebookModule).
 *
 * IMPORTANT: this must depend only on `PrismaService` + `FacebookGraphClient`,
 * NOT on `FacebookService`. `FacebookService` depends on `MessagesService`
 * (from `InboxModule`), and `MessagesService` optionally depends on this class
 * via `CHANNEL_DISPATCHER` — depending on `FacebookService` here would
 * recreate a circular dependency through the DI token (MessagesService ->
 * CHANNEL_DISPATCHER -> FacebookChannelDispatcherService -> FacebookService ->
 * MessagesService), which hangs Nest's dependency resolution instead of
 * throwing a clear circular-dependency error.
 */
@Injectable()
export class FacebookChannelDispatcherService implements ChannelDispatcher {
  constructor(
    private readonly prisma: PrismaService,
    private readonly graphClient: FacebookGraphClient,
  ) {}

  async dispatch(message: Message, conversation: Conversation): Promise<void> {
    if (conversation.channel !== 'FACEBOOK' || message.senderType !== 'AGENT') return
    // Internal notes are agent-authored but never meant for the customer —
    // never deliver them to Facebook.
    if (message.internalNote) return
    if (!conversation.contactId) return

    try {
      const identity = await this.prisma.contactChannelIdentity.findFirst({
        where: {
          tenantId: conversation.tenantId,
          contactId: conversation.contactId,
          channel: FACEBOOK_CHANNEL,
        },
        select: { externalId: true, channelConnectionId: true },
      })
      if (!identity) {
        await this.recordDispatchError(message.id, 'No Facebook PSID found for contact')
        return
      }

      // Prefer the specific page this PSID was seen on (so replies go out
      // under the correct page/token when a tenant has more than one active
      // Facebook page). Falls back to the tenant's oldest active connection
      // for identities created before this field existed.
      const connection = identity.channelConnectionId
        ? await this.prisma.channelConnection.findFirst({
            where: {
              id: identity.channelConnectionId,
              tenantId: conversation.tenantId,
              status: 'ACTIVE',
              deletedAt: null,
            },
          })
        : await this.prisma.channelConnection.findFirst({
            where: {
              tenantId: conversation.tenantId,
              channel: FACEBOOK_CHANNEL,
              status: 'ACTIVE',
              deletedAt: null,
            },
            orderBy: { createdAt: 'asc' },
          })
      if (!connection) {
        await this.recordDispatchError(message.id, 'No active Facebook page connection for tenant')
        return
      }

      const pageAccessToken = decryptToken(connection.accessTokenEncrypted)
      const payload = buildOutboundFacebookPayload(message)

      const result = await this.graphClient.sendMessage(
        pageAccessToken,
        identity.externalId,
        payload,
      )
      await this.mergeMetadata(message.id, { facebookDispatch: { success: true, result } })
    } catch (error) {
      await this.recordDispatchError(
        message.id,
        error instanceof Error ? error.message : 'Unknown Facebook dispatch error',
      )
    }
  }

  private async recordDispatchError(messageId: string, error: string): Promise<void> {
    await this.mergeMetadata(messageId, { facebookDispatch: { success: false, error } })
  }

  private async mergeMetadata(messageId: string, patch: Record<string, unknown>): Promise<void> {
    const existing = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { metadata: true },
    })
    const merged = {
      ...((existing?.metadata as Record<string, unknown> | null) ?? {}),
      ...patch,
    } as Prisma.InputJsonValue
    await this.prisma.message.update({ where: { id: messageId }, data: { metadata: merged } })
  }
}
