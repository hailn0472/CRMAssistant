import { Inject, Injectable, Optional } from '@nestjs/common'

import type { FacebookConversationsResponse } from './facebook-message.types'
import { FACEBOOK_METRICS_PORT, type FacebookMetricsPort } from '../observability/metrics.types'

export type FacebookMessagePayload = Record<string, unknown>

export const DEFAULT_GRAPH_API_VERSION = 'v21.0'
const RATE_LIMIT_MAX_REQUESTS = 600
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 hour — Facebook's outbound cap is 600 req/hour per app
const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5
const CIRCUIT_BREAKER_COOLDOWN_MS = 30_000
const MAX_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 100
const REQUEST_TIMEOUT_MS = 10_000

export class FacebookRateLimitError extends Error {
  constructor(message = 'Facebook outbound rate limit exceeded (600 requests/hour)') {
    super(message)
    this.name = 'FacebookRateLimitError'
  }
}

/** Thrown when the Graph API responds with a non-2xx status. Carries the HTTP
 * status so callers can distinguish retryable (5xx/network) failures from
 * permanent (4xx — bad token, invalid recipient, etc.) ones. */
export class FacebookGraphApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'FacebookGraphApiError'
  }
}

export class FacebookCircuitOpenError extends Error {
  constructor(message = 'Facebook Graph API circuit breaker is open') {
    super(message)
    this.name = 'FacebookCircuitOpenError'
  }
}

/**
 * Token-bucket-style outbound rate limiter for Facebook's 600 requests/hour-per-app cap.
 * In-memory `Map`-free rolling window is acceptable for MVP (single instance).
 * NOTE: this counter is per-process. If this service ever runs multi-instance,
 * move the counter to Redis (ioredis is already a project dependency) so all
 * instances share one budget — kept in-memory here per story scope.
 */
export class OutboundRateLimiter {
  private timestamps: number[] = []

  constructor(
    private readonly maxRequests: number = RATE_LIMIT_MAX_REQUESTS,
    private readonly windowMs: number = RATE_LIMIT_WINDOW_MS,
  ) {}

  tryAcquire(): boolean {
    const now = Date.now()
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs)
    if (this.timestamps.length >= this.maxRequests) {
      return false
    }
    this.timestamps.push(now)
    return true
  }
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

/** Small hand-rolled circuit breaker: opens after N consecutive failures, half-opens after a cooldown. */
export class CircuitBreaker {
  private state: CircuitState = 'CLOSED'
  private consecutiveFailures = 0
  private openedAt = 0

  constructor(
    private readonly failureThreshold: number = CIRCUIT_BREAKER_FAILURE_THRESHOLD,
    private readonly cooldownMs: number = CIRCUIT_BREAKER_COOLDOWN_MS,
  ) {}

  canAttempt(): boolean {
    if (this.state !== 'OPEN') return true

    if (Date.now() - this.openedAt >= this.cooldownMs) {
      this.state = 'HALF_OPEN'
      return true
    }
    return false
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0
    this.state = 'CLOSED'
  }

  recordFailure(): void {
    this.consecutiveFailures += 1
    if (this.state === 'HALF_OPEN' || this.consecutiveFailures >= this.failureThreshold) {
      this.state = 'OPEN'
      this.openedAt = Date.now()
    }
  }

  getState(): CircuitState {
    return this.state
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Thin wrapper over the Facebook Graph API using native `fetch` (Node 20+, no new HTTP dependency).
 * Never logs the page access token or app secret.
 */
export type FacebookGraphClientOptions = {
  rateLimiter?: OutboundRateLimiter
  circuitBreaker?: CircuitBreaker
}

@Injectable()
export class FacebookGraphClient {
  private readonly rateLimiter: OutboundRateLimiter
  private readonly circuitBreaker: CircuitBreaker

  constructor(
    @Optional() options: FacebookGraphClientOptions = {},
    @Optional() @Inject(FACEBOOK_METRICS_PORT) private readonly metrics?: FacebookMetricsPort,
  ) {
    this.rateLimiter = options.rateLimiter ?? new OutboundRateLimiter()
    this.circuitBreaker = options.circuitBreaker ?? new CircuitBreaker()
  }

  private get graphApiVersion(): string {
    return process.env['FACEBOOK_GRAPH_API_VERSION'] ?? DEFAULT_GRAPH_API_VERSION
  }

  private get baseUrl(): string {
    return `https://graph.facebook.com/${this.graphApiVersion}`
  }

  async sendMessage(
    pageAccessToken: string,
    recipientPsid: string,
    message: FacebookMessagePayload,
  ): Promise<Record<string, unknown>> {
    const requestBody = {
      recipient: { id: recipientPsid },
      messaging_type: 'RESPONSE',
      message,
    }

    return this.executeWithResilience('write', () =>
      this.postMessages(pageAccessToken, requestBody),
    )
  }

  /** Paginated read of `GET /me/conversations` (history sync, Story 8A.4).
   * Shares the same rate limiter/circuit breaker as `sendMessage` — Facebook's
   * 600 req/hour budget is per-app, not per-endpoint. */
  async getConversations(
    pageAccessToken: string,
    opts?: { after?: string },
  ): Promise<FacebookConversationsResponse> {
    return this.executeWithResilience('read', () => this.fetchConversations(pageAccessToken, opts))
  }

  /** Follows an absolute `paging.next` URL (used to drain a conversation's
   * nested `messages` pagination). Appends the access token only if the URL
   * doesn't already carry one — Graph API `paging.next` URLs are normally
   * pre-signed with it. */
  async getPageByUrl<T>(nextUrl: string, pageAccessToken?: string): Promise<T> {
    return this.executeWithResilience('read', () =>
      this.fetchPageByUrl<T>(nextUrl, pageAccessToken),
    )
  }

  /** Shared limiter/breaker/retry wrapper for every outbound Graph API call
   * (sends and reads alike — AC #7 requires them to share the 600/hr budget). */
  private async executeWithResilience<T>(
    operationGroup: 'read' | 'write',
    fn: () => Promise<T>,
  ): Promise<T> {
    if (!this.circuitBreaker.canAttempt()) {
      this.recordGraphRequest(operationGroup, 'rejected')
      throw new FacebookCircuitOpenError()
    }

    if (!this.rateLimiter.tryAcquire()) {
      this.recordGraphRequest(operationGroup, 'rate_limited')
      throw new FacebookRateLimitError()
    }

    let lastError: unknown

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const result = await fn()
        this.circuitBreaker.recordSuccess()
        this.recordGraphRequest(operationGroup, 'success')
        return result
      } catch (error) {
        lastError = error
        // 4xx responses (bad token, invalid recipient, malformed payload, ...)
        // won't succeed on retry — fail fast instead of burning the rate-limit
        // budget and retry attempts on a permanent failure.
        const isNonRetryable =
          error instanceof FacebookGraphApiError && error.status >= 400 && error.status < 500
        if (isNonRetryable) break
        if (attempt < MAX_ATTEMPTS) {
          await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1))
        }
      }
    }

    this.circuitBreaker.recordFailure()
    const finalError =
      lastError instanceof Error ? lastError : new Error('Facebook Graph API request failed')
    this.recordGraphRequest(operationGroup, this.graphErrorOutcome(finalError))
    throw finalError
  }

  private recordGraphRequest(
    operationGroup: 'read' | 'write',
    outcome: 'success' | 'error' | 'rejected' | 'rate_limited',
  ): void {
    try {
      this.metrics?.recordGraphRequest({ operationGroup, outcome })
    } catch {
      // Telemetry must never retry or fail a provider request that already completed.
    }
  }

  private graphErrorOutcome(error: Error): 'error' | 'rejected' | 'rate_limited' {
    if (error instanceof FacebookRateLimitError) return 'rate_limited'
    if (error instanceof FacebookGraphApiError) {
      if (error.status === 429) return 'rate_limited'
      if (error.status >= 400 && error.status < 500) return 'rejected'
    }
    return 'error'
  }

  private async postMessages(
    pageAccessToken: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const response = await fetch(
      `${this.baseUrl}/me/messages?access_token=${encodeURIComponent(pageAccessToken)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    )

    return this.parseJsonResponse<Record<string, unknown>>(response)
  }

  private async fetchConversations(
    pageAccessToken: string,
    opts?: { after?: string },
  ): Promise<FacebookConversationsResponse> {
    const fields = encodeURIComponent('participants,messages{message,from,to,created_time,id}')
    let url = `${this.baseUrl}/me/conversations?fields=${fields}&access_token=${encodeURIComponent(pageAccessToken)}`
    if (opts?.after) {
      url += `&after=${encodeURIComponent(opts.after)}`
    }

    const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    return this.parseJsonResponse<FacebookConversationsResponse>(response)
  }

  private async fetchPageByUrl<T>(nextUrl: string, pageAccessToken?: string): Promise<T> {
    const url =
      !pageAccessToken || nextUrl.includes('access_token=')
        ? nextUrl
        : `${nextUrl}${nextUrl.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(pageAccessToken)}`

    const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    return this.parseJsonResponse<T>(response)
  }

  private async parseJsonResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      // Consume the provider response so the underlying connection can be
      // reused, but never retain, log, or include its contents in an error.
      try {
        await response.text()
      } catch {
        // A malformed/partial provider response must not mask the status error.
      }
      throw new FacebookGraphApiError(
        response.status,
        // Do not retain or expose Graph API response bodies: they can contain
        // access-token hints, recipient identifiers, or provider diagnostics.
        `Facebook Graph API error (${response.status})`,
      )
    }

    return (await response.json()) as T
  }

  getCircuitState(): CircuitState {
    return this.circuitBreaker.getState()
  }
}
