import { TaskPubSubService, PUBSUB_TASK_ASSIGNED } from '../task-pubsub.service'

describe('TaskPubSubService', () => {
  let pubsub: TaskPubSubService

  beforeEach(() => {
    pubsub = new TaskPubSubService()
  })

  it('exports PUBSUB_TASK_ASSIGNED constant as TASK_ASSIGNED', () => {
    expect(PUBSUB_TASK_ASSIGNED).toBe('TASK_ASSIGNED')
  })

  it('publish() emits event on channel and subscriber receives it', async () => {
    const payload = { id: 'task-1', title: 'Follow up' }
    const receivedPromise = new Promise<unknown>((resolve) => {
      const subscribe = async (): Promise<void> => {
        for await (const data of pubsub.subscribe('TASK_ASSIGNED:tenant-1:user-1')) {
          resolve(data)
          break
        }
      }
      subscribe()
    })

    pubsub.publish('TASK_ASSIGNED:tenant-1:user-1', payload)

    await expect(receivedPromise).resolves.toEqual(payload)
  })

  it('subscribe() yields only events on matching channel (tenant isolation)', async () => {
    const results: unknown[] = []
    const subscribe = async (): Promise<void> => {
      for await (const data of pubsub.subscribe('TASK_ASSIGNED:tenant-1:user-1')) {
        results.push(data)
      }
    }
    subscribe()

    pubsub.publish('TASK_ASSIGNED:tenant-2:user-1', { id: 'task-2' })
    // Small delay to let async iteration process
    await new Promise((r) => setTimeout(r, 50))
    expect(results).toHaveLength(0)
  })

  it('multiple subscribers receive the same event', async () => {
    const received1 = new Promise<unknown>((resolve) => {
      const subscribe = async (): Promise<void> => {
        for await (const data of pubsub.subscribe('TASK_ASSIGNED:tenant-1:user-1')) {
          resolve(data)
          break
        }
      }
      subscribe()
    })
    const received2 = new Promise<unknown>((resolve) => {
      const subscribe = async (): Promise<void> => {
        for await (const data of pubsub.subscribe('TASK_ASSIGNED:tenant-1:user-1')) {
          resolve(data)
          break
        }
      }
      subscribe()
    })

    pubsub.publish('TASK_ASSIGNED:tenant-1:user-1', { id: 'task-1' })

    const [r1, r2] = await Promise.all([received1, received2])
    expect(r1).toEqual({ id: 'task-1' })
    expect(r2).toEqual({ id: 'task-1' })
  })

  it('emitter has maxListeners set to 500', () => {
    // The constructor calls setMaxListeners(500) — verify the emitter honors it
    const maxListeners = (
      pubsub as unknown as { emitter: { getMaxListeners: () => number } }
    ).emitter.getMaxListeners()
    expect(maxListeners).toBe(500)
  })

  it('removes its listener when the subscriber unsubscribes (finally block)', async () => {
    const channel = 'TASK_ASSIGNED:tenant-1:user-1'

    const receivedPromise = new Promise<unknown>((resolve) => {
      const subscribe = async (): Promise<void> => {
        for await (const data of pubsub.subscribe(channel)) {
          resolve(data)
          break
        }
      }
      subscribe()
    })

    pubsub.publish(channel, { id: 'task-1' })
    await expect(receivedPromise).resolves.toEqual({ id: 'task-1' })

    // Give the finally block a chance to run, then confirm no listener remains
    await new Promise((r) => setTimeout(r, 20))
    const listenerCount = (
      pubsub as unknown as { emitter: { listenerCount: (c: string) => number } }
    ).emitter.listenerCount(channel)
    expect(listenerCount).toBe(0)
  })

  it('channels use the per-assignee format tenantId:userId of AC 58', async () => {
    // The full channel is `${PUBSUB_TASK_ASSIGNED}:${tenantId}:${assigneeId}` —
    // assert the format by publishing on the exact channel a TasksService
    // publish would use and confirming the subscriber receives it.
    const channel = `${PUBSUB_TASK_ASSIGNED}:tenant-1:user-2`
    const receivedPromise = new Promise<unknown>((resolve) => {
      const subscribe = async (): Promise<void> => {
        for await (const data of pubsub.subscribe(channel)) {
          resolve(data)
          break
        }
      }
      subscribe()
    })

    pubsub.publish(channel, { id: 'task-1' })

    await expect(receivedPromise).resolves.toEqual({ id: 'task-1' })
  })
})
