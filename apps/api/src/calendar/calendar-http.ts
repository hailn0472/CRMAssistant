import { Injectable, Optional } from '@nestjs/common'

/**
 * Reliability layer for outbound calendar provider HTTP calls (Story 4.3,
 * NFR18/NFR20). Modelled directly on `FacebookGraphClient`: bounded retry
 * with exponential backoff + jitter, a circuit breaker that opens after 5
 * consecutive failures, a 10-second per-call timeout, and an in-memory
 * outbound rate limiter.
 *
 * Typed errors let callers tell retryable (5xx/network/429/403
 * rateLimitExceeded) from permanent (4xx) failures.
 */

const RATE_LIMIT_MAX_REQUESTS = 600
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 hour — generous per-provider cap
const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5
const CIRCUIT_BREAKER_COOLDOWN_MS = 30_000
const MAX_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 100
const REQUEST_TIMEOUT_MS = 10_000
/** Cap for honouring a provider `Retry-After` header. A longer wait (e.g. the
 * 3600s Google sometimes returns) must abort the pass and defer to the next
 * sweep, never block a request thread (AC 21). */
const DEFAULT_MAX_RETRY_AFTER_SECONDS = 60

export class CalendarRateLimitError extends Error {
  constructor(message = 'Calendar provider rate limit exceeded') {
    super(message)
    this.name = 'CalendarRateLimitError'
  }
}

/** Thrown when the provider responds with a non-2xx status. Carries the HTTP
 * status so callers can distinguish retryable (5xx/network/429/403
 * rateLimitExceeded) failures from permanent (4xx — bad token, invalid
 * payload, ...) ones, plus an optional `Retry-After` and a `rateLimited`
 * flag for 429 / 403 rateLimitExceeded. */
export class CalendarApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfterSeconds?: number,
    public readonly rateLimited = status === 429,
  ) {
    super(message)
    this.name = 'CalendarApiError'
  }
}

export class CalendarCircuitOpenError extends Error {
  constructor(message = 'Calendar provider circuit breaker is open') {
    super(message)
    this.name = 'CalendarCircuitOpenError'
  }
}

/**
 * Token-bucket-style outbound rate limiter for calendar provider caps.
 * In-memory rolling window is acceptable for MVP (single instance).
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

export type CalendarHttpOptions = {
  rateLimiter?: OutboundRateLimiter
  circuitBreaker?: CircuitBreaker
}

export type CalendarRequestOptions = {
  headers?: Record<string, string>
  /** An object is JSON-serialised; a string is sent verbatim (form bodies). */
  body?: unknown
  /** Upper bound in seconds for honouring a `Retry-After` header (AC 21). */
  maxRetryAfterSeconds?: number
}

/**
 * Thin wrapper over the calendar providers' HTTP APIs using native `fetch`
 * (Node 20+, no new HTTP dependency). Never logs access tokens or secrets.
 */
@Injectable()
export class CalendarHttp {
  private readonly rateLimiter: OutboundRateLimiter
  private readonly circuitBreaker: CircuitBreaker

  constructor(@Optional() options: CalendarHttpOptions = {}) {
    this.rateLimiter = options.rateLimiter ?? new OutboundRateLimiter()
    this.circuitBreaker = options.circuitBreaker ?? new CircuitBreaker()
  }

  getCircuitState(): CircuitState {
    return this.circuitBreaker.getState()
  }

  /** Shared limiter/breaker/retry wrapper for every outbound provider call. */
  async request<T>(method: string, url: string, options: CalendarRequestOptions = {}): Promise<T> {
    if (!this.circuitBreaker.canAttempt()) {
      throw new CalendarCircuitOpenError()
    }

    if (!this.rateLimiter.tryAcquire()) {
      throw new CalendarRateLimitError()
    }

    let lastError: unknown

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const result = await this.fetchOnce<T>(method, url, options)
        this.circuitBreaker.recordSuccess()
        return result
      } catch (error) {
        lastError = error
        // Permanent 4xx responses (bad token, invalid payload, ...) won't
        // succeed on retry — fail fast instead of burning the rate-limit
        // budget. 429 / 403 rateLimitExceeded are retryable (AC 21).
        const isPermanent =
          error instanceof CalendarApiError &&
          error.status >= 400 &&
          error.status < 500 &&
          !error.rateLimited
        if (isPermanent) break
        if (attempt < MAX_ATTEMPTS) {
          // eslint-disable-next-line no-await-in-loop
          await this.delayBeforeRetry(error, options.maxRetryAfterSeconds, attempt)
        }
      }
    }

    this.circuitBreaker.recordFailure()
    throw lastError instanceof Error ? lastError : new Error('Calendar API request failed')
  }

  /** Applies the provider's `Retry-After` when present (capped), otherwise
   * the computed exponential backoff with jitter (NFR18). */
  private async delayBeforeRetry(
    error: unknown,
    maxRetryAfterSeconds: number | undefined,
    attempt: number,
  ): Promise<void> {
    const retryAfter = error instanceof CalendarApiError ? error.retryAfterSeconds : undefined
    if (retryAfter !== undefined && retryAfter > 0) {
      const cap = maxRetryAfterSeconds ?? DEFAULT_MAX_RETRY_AFTER_SECONDS
      if (retryAfter > cap) {
        // A 3600-second Retry-After must abort the pass and defer to the next
        // sweep — never block a request thread (AC 21).
        throw new CalendarRateLimitError(
          `Provider requested retry in ${retryAfter}s (cap ${cap}s) — deferring to the next sweep`,
        )
      }
      // eslint-disable-next-line no-await-in-loop
      await sleep(retryAfter * 1000)
      return
    }
    // Exponential backoff with jitter (NFR18).
    const base = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)
    const jitter = Math.floor(Math.random() * base * 0.3)
    await sleep(base + jitter)
  }

  private async fetchOnce<T>(
    method: string,
    url: string,
    options: CalendarRequestOptions,
  ): Promise<T> {
    const headers: Record<string, string> = { ...(options.headers ?? {}) }
    let body: string | undefined
    if (options.body !== undefined) {
      if (typeof options.body === 'string') {
        body = options.body
        headers['Content-Type'] ??= 'application/x-www-form-urlencoded'
      } else {
        body = JSON.stringify(options.body)
        headers['Content-Type'] ??= 'application/json'
      }
    }

    let response: Response
    try {
      response = await fetch(url, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (error) {
      // Timeout (AbortSignal.timeout) — typed and retryable.
      if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      ) {
        throw new CalendarApiError(0, `Calendar API request timed out (${REQUEST_TIMEOUT_MS}ms)`)
      }
      // Network failure — retryable.
      throw error
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '')
      const retryAfterHeader = response.headers.get('retry-after')
      const retryAfterSeconds = retryAfterHeader
        ? Number.parseInt(retryAfterHeader, 10)
        : Number.NaN
      throw new CalendarApiError(
        response.status,
        `Calendar API error (${response.status}): ${errorBody.slice(0, 500)}`,
        Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined,
        response.status === 429 || errorBody.includes('rateLimitExceeded'),
      )
    }

    if (response.status === 204) {
      return undefined as T
    }
    return (await response.json()) as T
  }
}
