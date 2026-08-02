import { Injectable } from '@nestjs/common'
import { EventEmitter } from 'events'

export const PUBSUB_TASK_ASSIGNED = 'TASK_ASSIGNED'

@Injectable()
export class TaskPubSubService {
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
