// Lazy-loaded auth store reference — initialized once on first call to avoid
// circular dependency at module load time
let _getAccessToken: (() => string | null) | null = null

function getAccessToken(): string | null {
  if (!_getAccessToken) {
    try {
      // dynamic import to avoid circular deps at module load time
      const { useAuthStore } = require('../stores/auth.store')
      _getAccessToken = () => useAuthStore.getState().accessToken ?? null
    } catch {
      _getAccessToken = () => null
    }
  }
  return _getAccessToken()
}

export type SubscriptionOptions<T> = {
  query: string
  variables: Record<string, unknown>
  onData: (data: T) => void
  onError?: (error: Error) => void
}

const WS_RECONNECT_BASE_MS = 1000
const WS_RECONNECT_MAX_MS = 30000

export class GraphqlSubscriptionClient {
  private ws: WebSocket | null = null
  private subscriptions: Map<string, { options: SubscriptionOptions<any>; subId: string }> =
    new Map()
  private isConnected = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private destroyed = false
  private pendingSubs: Array<{ subId: string; query: string; variables: Record<string, unknown> }> =
    []

  private wsUrl: string

  constructor(url?: string) {
    if (url) {
      this.wsUrl = url.startsWith('ws')
        ? url
        : `${url.startsWith('http') ? url.replace(/^http/, 'ws') : `${typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}${url}`}/graphql`
    } else {
      const apiUrl =
        (typeof window !== 'undefined'
          ? (window as any).__NEXT_DATA__?.props?.pageProps?.API_URL
          : undefined) ?? 'http://localhost:4000'
      this.wsUrl = apiUrl.replace(/^http/, 'ws') + '/graphql'
    }
  }

  async connect(): Promise<void> {
    // Avoid duplicate connection attempts
    if (this.ws?.readyState === WebSocket.CONNECTING || this.ws?.readyState === WebSocket.OPEN)
      return

    const token = this.getAuthToken()
    if (!token) {
      this.scheduleReconnect()
      return
    }

    return new Promise((resolve) => {
      this.ws = new WebSocket(this.wsUrl, 'graphql-transport-ws')

      this.ws.onopen = () => {
        this.sendMessage({ type: 'connection_init', payload: { Authorization: `Bearer ${token}` } })
      }

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          this.handleMessage(msg, resolve)
        } catch {
          // ignore malformed messages
        }
      }

      this.ws.onclose = () => {
        this.isConnected = false
        if (!this.destroyed) {
          this.scheduleReconnect()
        }
      }

      this.ws.onerror = () => {
        // onclose will handle reconnect
      }
    })
  }

  private handleMessage(msg: any, onAck?: () => void): void {
    switch (msg.type) {
      case 'connection_ack':
        this.isConnected = true
        this.reconnectAttempts = 0
        onAck?.()
        // Re-subscribe active subscriptions that were lost on disconnect
        for (const [, sub] of this.subscriptions) {
          this.sendSubscribe(sub.subId, sub.options.query, sub.options.variables)
        }
        // Flush pending subscriptions
        for (const sub of this.pendingSubs) {
          this.sendSubscribe(sub.subId, sub.query, sub.variables)
        }
        this.pendingSubs = []
        break

      case 'ping':
        this.sendMessage({ type: 'pong' })
        break

      case 'next':
        for (const [, sub] of this.subscriptions) {
          if (sub.subId === msg.id) {
            try {
              sub.options.onData(msg.payload.data)
            } catch {
              // consumer error — ignore
            }
          }
        }
        break

      case 'error':
        for (const [, sub] of this.subscriptions) {
          if (sub.subId === msg.id) {
            sub.options.onError?.(new Error(msg.payload?.message ?? 'Subscription error'))
          }
        }
        break

      case 'complete':
        // Subscription ended on server side — clean up
        for (const [key, sub] of this.subscriptions) {
          if (sub.subId === msg.id) {
            this.subscriptions.delete(key)
          }
        }
        break
    }
  }

  subscribe<T>(key: string, options: SubscriptionOptions<T>): () => void {
    const subId = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    this.subscriptions.set(key, { options, subId })

    if (this.isConnected) {
      this.sendSubscribe(subId, options.query, options.variables)
    } else {
      this.pendingSubs.push({ subId, query: options.query, variables: options.variables })
    }

    return () => {
      this.subscriptions.delete(key)
      // Remove from pending subs too
      this.pendingSubs = this.pendingSubs.filter((s) => s.subId !== subId)
      if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
        this.sendMessage({ id: subId, type: 'complete' })
      }
    }
  }

  disconnect(): void {
    this.destroyed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.subscriptions.clear()
    this.pendingSubs = []
    this.ws?.close()
    this.ws = null
  }

  private sendSubscribe(subId: string, query: string, variables: Record<string, unknown>): void {
    this.sendMessage({
      id: subId,
      type: 'subscribe',
      payload: { query, variables },
    })
  }

  private sendMessage(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  private getAuthToken(): string | null {
    // Try Zustand auth store first (in-memory token)
    const storeToken = getAccessToken()
    if (storeToken) return storeToken

    // Fallback: try httpOnly auth-token cookie set by Next.js login route
    // (httpOnly means JS can't read it, but this is best-effort fallback)
    const cookieToken = document.cookie
      .split('; ')
      .find((c) => c.trim().startsWith('auth-token='))
      ?.split('=')[1]
    return cookieToken ?? null
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return
    // Clear previous timer to avoid multiple concurrent reconnect attempts
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
    }
    const delay = Math.min(WS_RECONNECT_BASE_MS * 2 ** this.reconnectAttempts, WS_RECONNECT_MAX_MS)
    this.reconnectAttempts++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }
}
