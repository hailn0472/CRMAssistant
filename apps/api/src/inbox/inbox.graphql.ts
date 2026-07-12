import { UnauthorizedException } from '@nestjs/common'

import { builder } from '../graphql/schema.builder'
import { requirePermission } from '../common/guards/permission-check'
import type { ConversationsService } from './conversations.service'
import type { MessagesService, SendMessageInput } from './messages.service'
import type { InboxPubSubService } from './pubsub.service'
import type { GraphqlContext } from '../graphql/graphql-context'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'
import type { Conversation, Message } from '@prisma/client'

// ──────────────────────────────────────────────
// Object Types
// ──────────────────────────────────────────────

const UserSummaryRef = builder
  .objectRef<{
    id: string
    firstName: string
    lastName: string
    email: string
  }>('UserSummary')
  .implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      firstName: t.exposeString('firstName'),
      lastName: t.exposeString('lastName'),
      email: t.exposeString('email'),
    }),
  })

const ContactSummaryRef = builder
  .objectRef<{
    id: string
    firstName: string
    lastName: string
    email: string
  }>('ContactSummary')
  .implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      firstName: t.exposeString('firstName'),
      lastName: t.exposeString('lastName'),
      email: t.exposeString('email'),
    }),
  })

type ConversationShape = Conversation & {
  contact?: { id: string; firstName: string; lastName: string; email: string } | null
  assignedToUser?: { id: string; firstName: string; lastName: string; email: string } | null
  _count?: { messages: number } | null
  lastMessagePreview?: string | null
}

const ConversationRef = builder.objectRef<ConversationShape>('Conversation').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    tenantId: t.exposeString('tenantId'),
    contactId: t.exposeString('contactId'),
    channel: t.exposeString('channel'),
    status: t.exposeString('status'),
    assignedTo: t.exposeString('assignedTo', { nullable: true }),
    lastMessageAt: t.string({
      nullable: true,
      resolve: (conv) => conv.lastMessageAt?.toISOString() ?? null,
    }),
    lastMessagePreview: t.string({
      nullable: true,
      resolve: async (conv) => {
        // Use pre-fetched value if available
        if (conv.lastMessagePreview !== undefined) return conv.lastMessagePreview
        // Lazy fallback — fetch from DB
        const prisma = getConversationsService()['prisma'] as import('@prisma/client').PrismaClient
        const msg = await prisma.message.findFirst({
          where: { conversationId: conv.id },
          orderBy: { createdAt: 'desc' },
          select: { content: true },
        })
        return msg?.content ?? null
      },
    }),
    contact: t.field({
      type: ContactSummaryRef,
      nullable: true,
      resolve: (conv) => conv.contact ?? null,
    }),
    assignedToUser: t.field({
      type: UserSummaryRef,
      nullable: true,
      resolve: (conv) => conv.assignedToUser ?? null,
    }),
    unreadCount: t.int({
      nullable: true,
      resolve: (conv, _args, context) => {
        // Return stored _count from findMany if available (pre-computed per-user)
        if (conv._count?.messages != null) return conv._count.messages
        // Fallback: use receipt queries via service (lazy)
        if (!context.user) return null
        return getConversationsService().countUnread(
          context.user.tenantId,
          context.user.userId,
          conv.id,
        )
      },
    }),
    createdAt: t.string({ resolve: (conv) => conv.createdAt.toISOString() }),
    updatedAt: t.string({ resolve: (conv) => conv.updatedAt.toISOString() }),
  }),
})

type MessageShape = Message

const MessageRef = builder.objectRef<MessageShape>('Message').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    conversationId: t.exposeString('conversationId'),
    senderId: t.exposeString('senderId'),
    senderType: t.exposeString('senderType'),
    content: t.exposeString('content'),
    messageType: t.exposeString('messageType'),
    internalNote: t.exposeBoolean('internalNote'),
    metadata: t.string({
      nullable: true,
      resolve: (msg) => (msg.metadata ? JSON.stringify(msg.metadata) : null),
    }),
    sentAt: t.string({ resolve: (msg) => msg.sentAt.toISOString() }),
    deliveredAt: t.string({
      nullable: true,
      resolve: (msg) => msg.deliveredAt?.toISOString() ?? null,
    }),
    readAt: t.string({
      nullable: true,
      resolve: (msg) => msg.readAt?.toISOString() ?? null,
    }),
    createdAt: t.string({ resolve: (msg) => msg.createdAt.toISOString() }),
  }),
})

const ConversationConnectionRef = builder
  .objectRef<{
    items: ConversationShape[]
    total: number
    page: number
    pageSize: number
  }>('ConversationConnection')
  .implement({
    fields: (t) => ({
      items: t.field({ type: [ConversationRef], resolve: (conn) => conn.items }),
      total: t.exposeInt('total'),
      page: t.exposeInt('page'),
      pageSize: t.exposeInt('pageSize'),
    }),
  })

const MessageConnectionRef = builder
  .objectRef<{
    items: MessageShape[]
    nextCursor: string | null
    hasMore: boolean
  }>('MessageConnection')
  .implement({
    fields: (t) => ({
      items: t.field({ type: [MessageRef], resolve: (conn) => conn.items }),
      nextCursor: t.exposeString('nextCursor', { nullable: true }),
      hasMore: t.exposeBoolean('hasMore'),
    }),
  })

// ──────────────────────────────────────────────
// Agent Info Type
// ──────────────────────────────────────────────

const AgentInfoRef = builder
  .objectRef<{
    id: string
    firstName: string
    lastName: string
    email: string
    jobTitle: string | null
    isOnline: boolean
    roleName: string
  }>('AgentInfo')
  .implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      firstName: t.exposeString('firstName'),
      lastName: t.exposeString('lastName'),
      email: t.exposeString('email'),
      jobTitle: t.exposeString('jobTitle', { nullable: true }),
      isOnline: t.exposeBoolean('isOnline'),
      roleName: t.exposeString('roleName'),
    }),
  })

// ──────────────────────────────────────────────
// Input Types
// ──────────────────────────────────────────────

const SENDER_TYPE = builder.enumType('SenderTypeEnum', {
  values: ['AGENT', 'CONTACT', 'SYSTEM'] as const,
})

const MESSAGE_TYPE = builder.enumType('MessageTypeEnum', {
  values: [
    'TEXT',
    'IMAGE',
    'VIDEO',
    'AUDIO',
    'FILE',
    'LOCATION',
    'TEMPLATE',
    'INTERNAL_NOTE',
  ] as const,
})

const SendMessageInputRef = builder.inputType('SendMessageInput', {
  fields: (t) => ({
    conversationId: t.string({ required: true }),
    senderId: t.string({ required: true }),
    senderType: t.field({ type: SENDER_TYPE, required: true }),
    content: t.string({ required: true }),
    messageType: t.field({ type: MESSAGE_TYPE }),
    metadata: t.string(),
  }),
})

const ConversationFilterInputRef = builder.inputType('ConversationFilterInput', {
  fields: (t) => ({
    channel: t.string(),
    status: t.string(),
    assignedTo: t.string(),
    unreadOnly: t.boolean(),
  }),
})

const ConversationPaginationInputRef = builder.inputType('ConversationPaginationInput', {
  fields: (t) => ({
    page: t.int(),
    pageSize: t.int(),
  }),
})

const MessagePaginationInputRef = builder.inputType('MessagePaginationInput', {
  fields: (t) => ({
    cursor: t.string(),
    limit: t.int(),
  }),
})

// ──────────────────────────────────────────────
// Module-Level State
// ──────────────────────────────────────────────

let conversationsService: ConversationsService | undefined
let messagesService: MessagesService | undefined
let inboxPubSub: InboxPubSubService | undefined

function getConversationsService(): ConversationsService {
  if (!conversationsService) throw new Error('ConversationsService not initialized')
  return conversationsService
}

function getMessagesService(): MessagesService {
  if (!messagesService) throw new Error('MessagesService not initialized')
  return messagesService
}

function getPubSub(): InboxPubSubService {
  if (!inboxPubSub) throw new Error('InboxPubSubService not initialized')
  return inboxPubSub
}

function requireUser(context: GraphqlContext): JwtPayload {
  if (!context.user) {
    throw new UnauthorizedException('Authentication required')
  }
  return context.user
}

const PUBSUB_NEW_MESSAGE = 'NEW_MESSAGE'
const PUBSUB_CONVERSATION_UPDATED = 'CONVERSATION_UPDATED'

// ──────────────────────────────────────────────
// Queries
// ──────────────────────────────────────────────

builder.queryFields((t) => ({
  conversation: t.field({
    type: ConversationRef,
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'INBOX', 'READ')
      return getConversationsService().findById(user.tenantId, String(args.id))
    },
  }),
  conversations: t.field({
    type: ConversationConnectionRef,
    args: {
      filter: t.arg({ type: ConversationFilterInputRef }),
      pagination: t.arg({ type: ConversationPaginationInputRef }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'INBOX', 'READ')
      // Inject current user for "my conversations" filter
      const filter = args.filter ?? {}
      if (filter.assignedTo === 'me') {
        filter.assignedTo = user.userId
      }
      return getConversationsService().findMany(
        user.tenantId,
        {
          channel: filter.channel ?? undefined,
          status: filter.status ?? undefined,
          assignedTo: filter.assignedTo ?? undefined,
          unreadOnly: filter.unreadOnly ?? undefined,
        },
        {
          page: args.pagination?.page ?? undefined,
          pageSize: args.pagination?.pageSize ?? undefined,
        },
        user.userId,
      )
    },
  }),
  messages: t.field({
    type: MessageConnectionRef,
    args: {
      conversationId: t.arg.id({ required: true }),
      pagination: t.arg({ type: MessagePaginationInputRef }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'INBOX', 'READ')
      return getMessagesService().findByConversation(user.tenantId, String(args.conversationId), {
        cursor: args.pagination?.cursor ?? undefined,
        limit: args.pagination?.limit ?? undefined,
      })
    },
  }),
  internalAgents: t.field({
    type: [AgentInfoRef],
    args: { tenantId: t.arg.string({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'INBOX', 'READ')
      if (user.tenantId !== args.tenantId) {
        throw new UnauthorizedException('Cannot access agents from another tenant')
      }
      return getConversationsService().findInternalAgents(args.tenantId)
    },
  }),
}))

// ──────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────

builder.mutationFields((t) => ({
  sendMessage: t.field({
    type: MessageRef,
    args: { input: t.arg({ type: SendMessageInputRef, required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'INBOX', 'WRITE')
      const input: SendMessageInput = {
        conversationId: args.input.conversationId,
        senderId: args.input.senderId,
        senderType: args.input.senderType,
        content: args.input.content,
        messageType: args.input.messageType ?? undefined,
        metadata: args.input.metadata ?? undefined,
      }
      return getMessagesService().sendMessage(user.tenantId, input)
    },
  }),
  markAsRead: t.field({
    type: 'Int',
    args: {
      conversationId: t.arg.id({ required: true }),
      messageIds: t.arg.idList(),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'INBOX', 'WRITE')
      return getMessagesService().markAsRead(
        user.tenantId,
        user.userId,
        String(args.conversationId),
        args.messageIds?.map(String) ?? undefined,
      )
    },
  }),
  assignConversation: t.field({
    type: ConversationRef,
    args: {
      conversationId: t.arg.id({ required: true }),
      userId: t.arg.id({ required: true }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'INBOX', 'WRITE')
      return getConversationsService().assignConversation(
        user.tenantId,
        String(args.conversationId),
        String(args.userId),
        user.userId,
      )
    },
  }),
  resolveConversation: t.field({
    type: ConversationRef,
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'INBOX', 'WRITE')
      return getConversationsService().resolveConversation(
        user.tenantId,
        String(args.id),
        user.userId,
      )
    },
  }),
  archiveConversation: t.field({
    type: ConversationRef,
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'INBOX', 'WRITE')
      return getConversationsService().archiveConversation(
        user.tenantId,
        String(args.id),
        user.userId,
      )
    },
  }),
  createInternalConversation: t.field({
    type: ConversationRef,
    args: {
      participantIds: t.arg.idList({ required: true }),
      title: t.arg.string(),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'INBOX', 'WRITE')
      return getConversationsService().createInternalConversation(
        user.tenantId,
        args.participantIds?.map(String) ?? [],
        args.title ?? undefined,
        user.userId,
      )
    },
  }),
}))

// ──────────────────────────────────────────────
// Subscriptions
// ──────────────────────────────────────────────

builder.subscriptionField('onNewMessage', (t) =>
  t.field({
    type: MessageRef,
    args: { conversationId: t.arg.id({ required: true }) },
    subscribe: async (_root, args, context) => {
      const user = requireUser(context)
      // Verify user's tenant owns this conversation before subscribing
      await getConversationsService().findById(user.tenantId, String(args.conversationId))
      return getPubSub().subscribe(`${PUBSUB_NEW_MESSAGE}:${String(args.conversationId)}`)
    },
    resolve: (payload: unknown) => payload as MessageShape,
  }),
)

builder.subscriptionField('onConversationUpdated', (t) =>
  t.field({
    type: ConversationRef,
    subscribe: (_root, _args, context) => {
      const user = requireUser(context)
      return getPubSub().subscribe(`${PUBSUB_CONVERSATION_UPDATED}:${user.tenantId}`)
    },
    resolve: (payload: unknown) => payload as ConversationShape,
  }),
)

// ──────────────────────────────────────────────
// Registration
// ──────────────────────────────────────────────

export function registerInboxGraphql(
  cs: ConversationsService,
  ms: MessagesService,
  ps: InboxPubSubService,
): void {
  conversationsService = cs
  messagesService = ms
  inboxPubSub = ps
}
