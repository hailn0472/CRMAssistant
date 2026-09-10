import type { Conversation, Message } from '@prisma/client'

/**
 * DI token for the optional outbound channel dispatcher.
 *
 * `MessagesService` depends on this via `@Optional() @Inject(CHANNEL_DISPATCHER)`
 * so that `InboxModule` never has to import a channel module (Facebook, and
 * later 8B channels) back — keeping the module dependency direction one-way
 * (channel module -> InboxModule). The concrete implementation is provided by
 * whichever channel module needs outbound delivery (see FacebookModule),
 * exported as a `@Global()` provider so it's visible to MessagesService
 * without InboxModule importing that module.
 */
export const CHANNEL_DISPATCHER = Symbol('CHANNEL_DISPATCHER')

export interface ChannelDispatcher {
  /** Called after a message has been persisted and the transaction has committed. */
  dispatch(message: Message, conversation: Conversation): Promise<void> | void
}
