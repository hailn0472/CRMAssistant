export type Conversation = {
  id: string
  tenantId: string
  contactId: string
  channel: string
  status: string
  assignedTo?: string | null
  lastMessageAt?: string | null
  contact?: { id: string; firstName: string; lastName: string; email: string } | null
  assignedToUser?: { id: string; firstName: string; lastName: string; email: string } | null
  unreadCount?: number | null
  createdAt: string
  updatedAt: string
}

export type ConversationConnection = {
  items: Conversation[]
  total: number
  page: number
  pageSize: number
}

export type Message = {
  id: string
  conversationId: string
  senderId: string
  senderType: 'AGENT' | 'CONTACT' | 'SYSTEM'
  content: string
  messageType: 'TEXT' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE' | 'LOCATION' | 'TEMPLATE'
  metadata?: string | null
  sentAt: string
  deliveredAt?: string | null
  readAt?: string | null
  createdAt: string
}

export type MessageConnection = {
  items: Message[]
  nextCursor: string | null
  hasMore: boolean
}

export type ConversationFilter = {
  channel?: string
  status?: string
  assignedTo?: string
  unreadOnly?: boolean
}

export type SendMessageInput = {
  conversationId: string
  senderId: string
  senderType: 'AGENT' | 'CONTACT' | 'SYSTEM'
  content: string
  messageType?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE' | 'LOCATION' | 'TEMPLATE'
  metadata?: string
}

import { graphqlRequest } from '@/lib/graphql-client'

function assertData<T>(data: T | null | undefined, name: string): T {
  if (data == null) throw new Error(`InboxService: ${name} returned null`)
  return data
}

const CONVERSATION_FIELDS = `
  id
  tenantId
  contactId
  channel
  status
  assignedTo
  lastMessageAt
  contact { id firstName lastName email }
  assignedToUser { id firstName lastName email }
  unreadCount
  createdAt
  updatedAt
`

const MESSAGE_FIELDS = `
  id
  conversationId
  senderId
  senderType
  content
  messageType
  metadata
  sentAt
  deliveredAt
  readAt
  createdAt
`

export async function getConversations(
  pagination: { page: number; pageSize: number },
  filter?: ConversationFilter,
): Promise<ConversationConnection> {
  const data = await graphqlRequest<{ conversations: ConversationConnection }>(
    `query Conversations($filter: ConversationFilterInput, $pagination: ConversationPaginationInput) {
      conversations(filter: $filter, pagination: $pagination) {
        total
        page
        pageSize
        items { ${CONVERSATION_FIELDS} }
      }
    }`,
    {
      filter: filter ?? undefined,
      pagination,
    },
  )
  return assertData(data.conversations, 'conversations')
}

export async function getConversation(id: string): Promise<Conversation> {
  const data = await graphqlRequest<{ conversation: Conversation }>(
    `query Conversation($id: ID!) {
      conversation(id: $id) { ${CONVERSATION_FIELDS} }
    }`,
    { id },
  )
  return assertData(data.conversation, 'conversation')
}

export async function getMessages(
  conversationId: string,
  pagination?: { cursor?: string; limit?: number },
): Promise<MessageConnection> {
  const data = await graphqlRequest<{ messages: MessageConnection }>(
    `query Messages($conversationId: ID!, $pagination: MessagePaginationInput) {
      messages(conversationId: $conversationId, pagination: $pagination) {
        items { ${MESSAGE_FIELDS} }
        nextCursor
        hasMore
      }
    }`,
    { conversationId, pagination: pagination ?? undefined },
  )
  return assertData(data.messages, 'messages')
}

export async function sendMessage(input: SendMessageInput): Promise<Message> {
  const data = await graphqlRequest<{ sendMessage: Message }>(
    `mutation SendMessage($input: SendMessageInput!) {
      sendMessage(input: $input) { ${MESSAGE_FIELDS} }
    }`,
    { input },
  )
  return assertData(data.sendMessage, 'sendMessage')
}

export async function markAsRead(conversationId: string, messageIds?: string[]): Promise<number> {
  const data = await graphqlRequest<{ markAsRead: number }>(
    `mutation MarkAsRead($conversationId: ID!, $messageIds: [ID!]) {
      markAsRead(conversationId: $conversationId, messageIds: $messageIds)
    }`,
    { conversationId, messageIds: messageIds ?? undefined },
  )
  if (data.markAsRead == null) throw new Error('InboxService: markAsRead returned null')
  return data.markAsRead
}

export async function assignConversation(
  conversationId: string,
  userId: string,
): Promise<Conversation> {
  const data = await graphqlRequest<{ assignConversation: Conversation }>(
    `mutation AssignConversation($conversationId: ID!, $userId: ID!) {
      assignConversation(conversationId: $conversationId, userId: $userId) { ${CONVERSATION_FIELDS} }
    }`,
    { conversationId, userId },
  )
  return assertData(data.assignConversation, 'assignConversation')
}

export async function resolveConversation(id: string): Promise<Conversation> {
  const data = await graphqlRequest<{ resolveConversation: Conversation }>(
    `mutation ResolveConversation($id: ID!) {
      resolveConversation(id: $id) { ${CONVERSATION_FIELDS} }
    }`,
    { id },
  )
  return assertData(data.resolveConversation, 'resolveConversation')
}

export async function archiveConversation(id: string): Promise<Conversation> {
  const data = await graphqlRequest<{ archiveConversation: Conversation }>(
    `mutation ArchiveConversation($id: ID!) {
      archiveConversation(id: $id) { ${CONVERSATION_FIELDS} }
    }`,
    { id },
  )
  return assertData(data.archiveConversation, 'archiveConversation')
}
