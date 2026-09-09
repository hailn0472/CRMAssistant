import { ConfigService } from '@nestjs/config'

import { CacheService } from '../cache.service'
import type { CacheMetricsPort } from '../../observability/metrics.types'

type RedisStub = {
  status: string
  get: jest.Mock<Promise<string | null>, [string]>
  set: jest.Mock<Promise<unknown>, [string, string, 'EX', number]>
  incr: jest.Mock<Promise<unknown>, [string]>
  quit: jest.Mock<Promise<unknown>, []>
}

function makeMetrics(): CacheMetricsPort & {
  recordCacheOperation: jest.Mock
  recordCacheFallback: jest.Mock
} {
  return {
    recordCacheOperation: jest.fn(),
    recordCacheFallback: jest.fn(),
  }
}

function makeRedis(): RedisStub {
  return {
    status: 'ready',
    get: jest.fn(),
    set: jest.fn().mockResolvedValue('OK'),
    incr: jest.fn().mockResolvedValue(1),
    quit: jest.fn().mockResolvedValue('OK'),
  }
}

function makeConfig(redisUrl?: string): ConfigService {
  return { get: jest.fn().mockReturnValue(redisUrl) } as unknown as ConfigService
}

describe('CacheService', () => {
  it('falls back when Redis is disabled and reports a bounded outcome', async () => {
    const metrics = makeMetrics()
    const service = new CacheService(makeConfig(), metrics)

    await expect(
      service.getOrSetTenantJson('contacts', 'tenant', 'list', 30, async () => ['db']),
    ).resolves.toEqual(['db'])

    expect(metrics.recordCacheOperation).toHaveBeenCalledWith({
      operation: 'get',
      outcome: 'disabled',
    })
    expect(metrics.recordCacheOperation).toHaveBeenCalledWith({
      operation: 'get',
      outcome: 'fallback',
    })
    expect(metrics.recordCacheFallback).toHaveBeenCalledWith({ reason: 'redis_unavailable' })
    expect(service.getHealth()).toEqual({ status: 'disabled', configured: false })
  })

  it('returns a cache hit without invoking the loader', async () => {
    const metrics = makeMetrics()
    const service = new CacheService(makeConfig('redis://cache'), metrics)
    const redis = makeRedis()
    redis.get.mockResolvedValue(JSON.stringify({ id: 'cached' }))
    ;(service as unknown as { client: RedisStub }).client = redis
    const loader = jest.fn().mockResolvedValue({ id: 'database' })

    await expect(
      service.getOrSetTenantJson('contacts', 'tenant', 'list', 30, loader),
    ).resolves.toEqual({
      id: 'cached',
    })

    expect(loader).not.toHaveBeenCalled()
    expect(metrics.recordCacheOperation).toHaveBeenCalledWith({ operation: 'get', outcome: 'hit' })
  })

  it('records miss and writes the database fallback result', async () => {
    const metrics = makeMetrics()
    const service = new CacheService(makeConfig('redis://cache'), metrics)
    const redis = makeRedis()
    redis.get.mockResolvedValue(null)
    ;(service as unknown as { client: RedisStub }).client = redis

    await expect(
      service.getOrSetTenantJson('contacts', 'tenant', 'list', 30, async () => ['db']),
    ).resolves.toEqual(['db'])

    expect(metrics.recordCacheOperation).toHaveBeenCalledWith({ operation: 'get', outcome: 'miss' })
    expect(metrics.recordCacheOperation).toHaveBeenCalledWith({
      operation: 'get',
      outcome: 'fallback',
    })
    expect(metrics.recordCacheFallback).toHaveBeenCalledWith({ reason: 'redis_miss' })
    expect(metrics.recordCacheOperation).toHaveBeenCalledWith({
      operation: 'set',
      outcome: 'success',
    })
  })

  it('records Redis errors while preserving the loader result', async () => {
    const metrics = makeMetrics()
    const service = new CacheService(makeConfig('redis://cache'), metrics)
    const redis = makeRedis()
    redis.get.mockRejectedValue(new Error('connection refused'))
    ;(service as unknown as { client: RedisStub }).client = redis

    await expect(
      service.getOrSetTenantJson('contacts', 'tenant', 'list', 30, async () => ['db']),
    ).resolves.toEqual(['db'])

    expect(metrics.recordCacheOperation).toHaveBeenCalledWith({
      operation: 'get',
      outcome: 'error',
    })
    expect(metrics.recordCacheOperation).toHaveBeenCalledWith({
      operation: 'get',
      outcome: 'fallback',
    })
    expect(metrics.recordCacheFallback).toHaveBeenCalledWith({ reason: 'redis_error' })
    // A transient command error does not make a currently-ready client
    // permanently degraded; readiness follows the client state.
    expect(service.getHealth()).toEqual({ status: 'ready', configured: true })
  })

  it('uses error, rather than disabled, when configured Redis is unavailable', async () => {
    const metrics = makeMetrics()
    const service = new CacheService(makeConfig('redis://cache'), metrics)
    const redis = makeRedis()
    redis.status = 'end'
    ;(service as unknown as { client: RedisStub }).client = redis

    await expect(
      service.getOrSetTenantJson('contacts', 'tenant', 'list', 30, async () => ['db']),
    ).resolves.toEqual(['db'])

    expect(metrics.recordCacheOperation).toHaveBeenCalledWith({
      operation: 'get',
      outcome: 'error',
    })
    expect(metrics.recordCacheOperation).not.toHaveBeenCalledWith({
      operation: 'get',
      outcome: 'disabled',
    })
    expect(service.getHealth()).toEqual({ status: 'degraded', configured: true })
  })

  it('does not classify invalidation as disabled when configured Redis is unavailable', async () => {
    const metrics = makeMetrics()
    const service = new CacheService(makeConfig('redis://cache'), metrics)
    const redis = makeRedis()
    redis.status = 'end'
    ;(service as unknown as { client: RedisStub }).client = redis

    await expect(service.invalidateTenant('contacts', 'tenant')).resolves.toBeUndefined()

    expect(metrics.recordCacheOperation).toHaveBeenCalledWith({
      operation: 'delete',
      outcome: 'error',
    })
  })
})
