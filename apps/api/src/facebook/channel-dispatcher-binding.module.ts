import { Global, Module } from '@nestjs/common'

import { CHANNEL_DISPATCHER } from '../inbox/channel-dispatcher'
import { FacebookModule } from './facebook.module'
import { FacebookChannelDispatcherService } from './facebook-channel-dispatcher.service'

/**
 * Narrowly exposes only the `CHANNEL_DISPATCHER` token globally, so
 * `MessagesService` (in `InboxModule`) can `@Optional() @Inject` it without
 * `InboxModule` ever importing `FacebookModule` back (which would create a
 * circular module dependency). Everything else in `FacebookModule`
 * (`FacebookService`, `FacebookGraphClient`, ...) stays ordinarily scoped —
 * see Story 8A.3 code review (the previous approach made the whole
 * `FacebookModule` `@Global()`, which was broader than this fix needs).
 */
@Global()
@Module({
  imports: [FacebookModule],
  providers: [{ provide: CHANNEL_DISPATCHER, useExisting: FacebookChannelDispatcherService }],
  exports: [CHANNEL_DISPATCHER],
})
export class ChannelDispatcherBindingModule {}
