import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'
import type { ChannelConnection } from '@prisma/client'

import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { ConversationsService } from '../inbox/conversations.service'
import { MessagesService } from '../inbox/messages.service'
import { encryptToken } from '../common/crypto/token-crypto'
import { mapInboundFacebookMessage } from './facebook-message-mapper'
import type { FacebookMessagingEvent } from './facebook-message.types'

const FACEBOOK_CHANNEL = 'FACEBOOK' as const
const SYSTEM_ACTOR = 'system'

export type ConnectFacebookPageInput = {
  pageId: string
  accessToken: string
  displayName?: string
}

export type FacebookPageConnection = Omit<ChannelConnection, 'accessTokenEncrypted'>

@Injectable()
export class FacebookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly conversationsService: ConversationsService,
    private readonly messagesService: MessagesService,
  ) {}

  // ── Page connection management (AC #1, #11) ──────────────────────────

  async connectPage(
    tenantId: string,
    userId: string,
    input: ConnectFacebookPageInput,
  ): Promise<FacebookPageConnection> {
    const pageId = input.pageId?.trim()
    if (!pageId) {
      throw new BadRequestException('pageId is required')
    }
    if (!input.accessToken) {
      throw new BadRequestException('accessToken is required')
    }

    // Interim mitigation (Story 8A.3 review, Decision #1) until real Facebook
    // OAuth page-ownership verification exists: reject connecting a pageId
    // that another tenant already holds ACTIVE. Without this, any tenant could
    // register another tenant's real Facebook page id and (since inbound
    // routing has no tie-break) hijack that tenant's Messenger conversations.
    const claimedByAnotherTenant = await this.prisma.channelConnection.findFirst({
      where: {
        channel: FACEBOOK_CHANNEL,
        externalId: pageId,
        status: 'ACTIVE',
        deletedAt: null,
        tenantId: { not: tenantId },
      },
      select: { id: true },
    })
    if (claimedByAnotherTenant) {
      throw new ConflictException('This Facebook page is already connected to another workspace')
    }

    const accessTokenEncrypted = encryptToken(input.accessToken)

    const connection = await this.prisma.channelConnection.upsert({
      where: {
        tenantId_channel_externalId: { tenantId, channel: FACEBOOK_CHANNEL, externalId: pageId },
      },
      create: {
        tenantId,
        channel: FACEBOOK_CHANNEL,
        externalId: pageId,
        accessTokenEncrypted,
        displayName: input.displayName,
        status: 'ACTIVE',
        createdBy: userId,
        updatedBy: userId,
      },
      update: {
        accessTokenEncrypted,
        displayName: input.displayName,
        status: 'ACTIVE',
        updatedBy: userId,
        deletedAt: null,
      },
    })

    await this.auditService.log({
      tenantId,
      userId,
      action: 'CREATE',
      entity: 'ChannelConnection',
      entityId: connection.id,
      details: { channel: FACEBOOK_CHANNEL, pageId, displayName: input.displayName ?? null },
    })

    return this.omitToken(connection)
  }

  async disconnectPage(tenantId: string, userId: string, pageId: string): Promise<boolean> {
    const connection = await this.prisma.channelConnection.findFirst({
      where: { tenantId, channel: FACEBOOK_CHANNEL, externalId: pageId, deletedAt: null },
    })

    if (!connection) {
      throw new NotFoundException('Facebook page connection not found')
    }

    await this.prisma.channelConnection.update({
      where: { id: connection.id },
      data: { status: 'DISCONNECTED', updatedBy: userId },
    })

    await this.auditService.log({
      tenantId,
      userId,
      action: 'DELETE',
      entity: 'ChannelConnection',
      entityId: connection.id,
      details: { channel: FACEBOOK_CHANNEL, pageId },
    })

    return true
  }

  async listPages(tenantId: string): Promise<FacebookPageConnection[]> {
    const connections = await this.prisma.channelConnection.findMany({
      where: { tenantId, channel: FACEBOOK_CHANNEL, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    })

    return connections.map((connection) => this.omitToken(connection))
  }

  private omitToken(connection: ChannelConnection): FacebookPageConnection {
    return {
      id: connection.id,
      tenantId: connection.tenantId,
      channel: connection.channel,
      externalId: connection.externalId,
      displayName: connection.displayName,
      status: connection.status,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
      createdBy: connection.createdBy,
      updatedBy: connection.updatedBy,
      deletedAt: connection.deletedAt,
    }
  }

  /**
   * Finds the tenant + active connection owning a Facebook page id.
   * NOTE: `externalId` is only unique per-tenant in the schema (Facebook page
   * ids are unique in the real world, but this table doesn't enforce that
   * globally) — `findFirst` reflects that a page is expected to belong to
   * exactly one tenant in practice.
   */
  async resolveActiveConnectionByPageId(
    pageId: string,
  ): Promise<{ tenantId: string; connection: ChannelConnection } | null> {
    const connection = await this.prisma.channelConnection.findFirst({
      where: { channel: FACEBOOK_CHANNEL, externalId: pageId, status: 'ACTIVE', deletedAt: null },
    })
    if (!connection) return null
    return { tenantId: connection.tenantId, connection }
  }

  // ── Contact identity resolution (AC #5) ───────────────────────────────

  /** Resolves the tenant's ADMIN user, falling back to the earliest active user. */
  async resolveSystemOwnerId(tenantId: string): Promise<string> {
    const adminAssignment = await this.prisma.userRole.findFirst({
      where: {
        role: { tenantId, name: 'ADMIN', deletedAt: null },
        user: { tenantId, deletedAt: null, isActive: true },
      },
      orderBy: { assignedAt: 'asc' },
      select: { userId: true },
    })
    if (adminAssignment) return adminAssignment.userId

    const fallbackUser = await this.prisma.user.findFirst({
      where: { tenantId, deletedAt: null, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
    if (!fallbackUser) {
      throw new BadRequestException(
        `No active user found for tenant ${tenantId} to own auto-created Facebook contacts`,
      )
    }
    return fallbackUser.id
  }

  /** Finds the Contact for a PSID, auto-creating one (idempotent) if it doesn't exist yet. */
  async resolveOrCreateContactForPsid(
    tenantId: string,
    psid: string,
    channelConnectionId?: string,
    profileName?: { firstName?: string; lastName?: string },
  ): Promise<string> {
    const existing = await this.prisma.contactChannelIdentity.findUnique({
      where: {
        tenantId_channel_externalId: { tenantId, channel: FACEBOOK_CHANNEL, externalId: psid },
      },
      select: { contactId: true },
    })
    if (existing) return existing.contactId

    const ownerId = await this.resolveSystemOwnerId(tenantId)
    const firstName = profileName?.firstName?.trim() || 'Facebook'
    const lastName = profileName?.lastName?.trim() || 'User'
    const email = `fb_${psid}@facebook.local`

    try {
      const contact = await this.prisma.$transaction(async (tx) => {
        const created = await tx.contact.create({
          data: {
            tenantId,
            email,
            firstName,
            lastName,
            ownerId,
            createdBy: ownerId,
            updatedBy: ownerId,
          },
        })
        await tx.contactChannelIdentity.create({
          data: {
            tenantId,
            contactId: created.id,
            channel: FACEBOOK_CHANNEL,
            externalId: psid,
            channelConnectionId,
          },
        })
        return created
      })
      return contact.id
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
        // Race: a concurrent webhook event for the same PSID won — reuse its contact.
        const raceWinner = await this.prisma.contactChannelIdentity.findUnique({
          where: {
            tenantId_channel_externalId: { tenantId, channel: FACEBOOK_CHANNEL, externalId: psid },
          },
          select: { contactId: true },
        })
        if (raceWinner) return raceWinner.contactId
      }
      throw error
    }
  }

  // ── Inbound message handling (AC #2, #4, #5) ──────────────────────────

  async handleInboundMessagingEvent(pageId: string, event: FacebookMessagingEvent): Promise<void> {
    const psid = event.sender?.id
    if (!psid || !event.message) {
      // Not a user message (e.g. delivery/read receipt, postback) — nothing to persist yet.
      return
    }

    if (event.message.is_echo) {
      // Echo of our own outbound send on this page — not a genuine inbound
      // customer message. Ignoring it prevents bogus contacts/conversations
      // being created from our own agent replies being echoed back.
      return
    }

    const resolved = await this.resolveActiveConnectionByPageId(pageId)
    if (!resolved) {
      // Unknown/disconnected page — cannot resolve a tenant, so there's nothing safe to do.
      return
    }
    const { tenantId, connection } = resolved

    const contactId = await this.resolveOrCreateContactForPsid(tenantId, psid, connection.id)

    let conversation = await this.conversationsService.findOrCreateConversation(
      tenantId,
      contactId,
      FACEBOOK_CHANNEL,
      SYSTEM_ACTOR,
    )

    // findOrCreateConversation only re-opens ARCHIVED conversations, not RESOLVED
    // ones. Inbound customer messages must never be silently dropped because an
    // agent previously resolved the thread.
    if (conversation.status === 'RESOLVED') {
      conversation = await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { status: 'OPEN', updatedBy: SYSTEM_ACTOR },
      })
    }

    const mid = event.message.mid
    if (mid) {
      // Facebook delivers webhook events at-least-once — a slow/non-200
      // response causes a redelivery of the same event. Skip if we've already
      // persisted a message for this Facebook message id in this conversation.
      const duplicate = await this.prisma.message.findFirst({
        where: { conversationId: conversation.id, metadata: { path: ['mid'], equals: mid } },
        select: { id: true },
      })
      if (duplicate) return
    }

    const { content, messageType, metadata } = mapInboundFacebookMessage(event.message)

    await this.messagesService.sendMessage(tenantId, {
      conversationId: conversation.id,
      senderId: contactId,
      senderType: 'CONTACT',
      content,
      messageType,
      metadata,
    })
  }
}
