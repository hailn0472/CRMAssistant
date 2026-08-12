import { Injectable } from '@nestjs/common'
import { EventEmitter } from 'events'

export const PUBSUB_NOTIFICATION_CREATED = 'NOTIFICATION_CREATED'

/**
 * Story 4.8 (AC 14): in-process fan-out for the `onNotificationReceived`
 * subscription — a verbatim sibling of TaskPubSubService with the identical
 * shape.
 *
 * 🚨 This is a fan-out to live subscribers, NOT a job queue: `subscribe()`
 * drops any event emitted while no consumer is pending, and the emitter is
 * per-process. Single-instance only — needs a Redis-backed pub/sub for
 * multi-instance deployments (see deferred-work.md, Story 4.8).
 */
@Injectable()
export class NotificationPubSubService {
  private emitter = new EventEmitter()
  /** Max listeners to prevent memory leak warnings for many subscription channels */
  private readonly MAX_LISTENERS = 500

  constructor() {
    this.emitter.setMaxListeners(this.MAX_LISTENERS)
  }

  publish(channel: string, payload: unknown): void {
    this.emitter.emit(channel, payload)
  }

  async *subscribe<T>(channel: string): AsyncIterable<T> {
    const listeners: Array<(value: T) => void> = []
    const handler = (payload: T): void => {
      for (const resolve of listeners.splice(0)) {
        resolve(payload)
      }
    }
    this.emitter.on(channel, handler)
    try {
      while (true) {
        yield new Promise<T>((resolve) => {
          listeners.push(resolve)
        })
      }
    } finally {
      this.emitter.off(channel, handler)
    }
  }
}
