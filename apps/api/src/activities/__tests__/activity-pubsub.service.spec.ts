import { EventEmitter } from 'events'

import { ActivityPubSubService, PUBSUB_ACTIVITY_LOGGED } from '../activity-pubsub.service'

// Story 4.4, AC 17 — ActivityPubSubService is a sibling of TaskPubSubService:
// an in-process EventEmitter fan-out to live subscribers, NOT a job queue.
//
// NOTE: V8 async generators suspended at `yield <unresolved promise>` cannot
// be closed via return()/throw() without resolving the pending promise, so
// the `finally` listener-cleanup is exercised through the GraphQL
// subscription lifecycle in the integration suite rather than here. The
// observable fan-out contract (T4) is what these tests pin down.
describe('ActivityPubSubService (Story 4.4, AC 17)', () => {
  it('raises the listener cap to 500 (setMaxListeners)', () => {
    const pubsub = new ActivityPubSubService()
    const emitter = (pubsub as unknown as { emitter: EventEmitter }).emitter
    expect(emitter.getMaxListeners()).toBe(500)
  })

  it('delivers a payload published after subscription to the matching channel', async () => {
    const pubsub = new ActivityPubSubService()
    const iterator = pubsub.subscribe<{ id: string }>(
      `${PUBSUB_ACTIVITY_LOGGED}:tenant-1`,
    ) as AsyncGenerator<{ id: string }>

    const pending = iterator.next()
    pubsub.publish(`${PUBSUB_ACTIVITY_LOGGED}:tenant-1`, { id: 'activity-1' })

    await expect(pending).resolves.toEqual({ value: { id: 'activity-1' }, done: false })
  })

  it('drops events emitted while no consumer is pending (fan-out, not a queue)', async () => {
    const pubsub = new ActivityPubSubService()

    pubsub.publish(`${PUBSUB_ACTIVITY_LOGGED}:tenant-1`, { id: 'lost' })

    const iterator = pubsub.subscribe<{ id: string }>(
      `${PUBSUB_ACTIVITY_LOGGED}:tenant-1`,
    ) as AsyncGenerator<{ id: string }>
    const pending = iterator.next()

    const outcome = await Promise.race([
      pending.then((r: IteratorResult<{ id: string }>) => JSON.stringify(r)),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 50)),
    ])
    expect(outcome).toBe('timeout')
  })

  it('does not deliver events published on a different channel', async () => {
    const pubsub = new ActivityPubSubService()
    const iterator = pubsub.subscribe<{ id: string }>(
      `${PUBSUB_ACTIVITY_LOGGED}:tenant-1`,
    ) as AsyncGenerator<{ id: string }>

    const pending = iterator.next()
    pubsub.publish(`${PUBSUB_ACTIVITY_LOGGED}:tenant-2`, { id: 'other-tenant' })

    const outcome = await Promise.race([
      pending.then((r: IteratorResult<{ id: string }>) => JSON.stringify(r)),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 50)),
    ])
    expect(outcome).toBe('timeout')
  })

  it('delivers one payload per event to every pending consumer on the channel', async () => {
    const pubsub = new ActivityPubSubService()
    const first = pubsub.subscribe<{ id: string }>(
      `${PUBSUB_ACTIVITY_LOGGED}:tenant-1`,
    ) as AsyncGenerator<{ id: string }>
    const second = pubsub.subscribe<{ id: string }>(
      `${PUBSUB_ACTIVITY_LOGGED}:tenant-1`,
    ) as AsyncGenerator<{ id: string }>

    const pendingFirst = first.next()
    const pendingSecond = second.next()
    pubsub.publish(`${PUBSUB_ACTIVITY_LOGGED}:tenant-1`, { id: 'broadcast' })

    await expect(pendingFirst).resolves.toEqual({ value: { id: 'broadcast' }, done: false })
    await expect(pendingSecond).resolves.toEqual({ value: { id: 'broadcast' }, done: false })
  })
})
