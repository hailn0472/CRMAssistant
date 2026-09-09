import { HealthController } from '../health.controller'
import type { CacheHealth, CacheService } from '../../cache/cache.service'
import type { DependencyMetricsPort } from '../../observability/metrics.types'
import type { PrismaService } from '../../prisma/prisma.service'

describe('HealthController', () => {
  let controller: HealthController

  beforeEach(() => {
    controller = new HealthController()
  })

  describe('getHealth', () => {
    it('should return status ok', () => {
      const result = controller.getHealth()

      expect(result).toEqual({ status: 'ok' })
    })

    it('should return an object with status property', () => {
      const result = controller.getHealth()

      expect(result).toHaveProperty('status')
    })

    it('should always return ok status (idempotent)', () => {
      const result1 = controller.getHealth()
      const result2 = controller.getHealth()

      expect(result1).toEqual(result2)
    })

    describe('getLiveness', () => {
      it('does not require a database or cache', () => {
        expect(controller.getLiveness()).toEqual({ status: 'ok' })
      })
    })

    describe('getReadiness', () => {
      const makeMetrics = (): DependencyMetricsPort & { setDependencyReady: jest.Mock } => ({
        setDependencyReady: jest.fn(),
      })

      const makeCache = (
        status: CacheHealth['status'],
      ): { getHealth: jest.Mock<CacheHealth, []> } => ({
        getHealth: jest.fn().mockReturnValue({ status, configured: status !== 'disabled' }),
      })

      it('returns degraded 200 when PostgreSQL is ready and Redis is optional', async () => {
        const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) }
        const metrics = makeMetrics()
        const health = new HealthController(
          prisma as unknown as PrismaService,
          makeCache('disabled') as unknown as CacheService,
          metrics,
        )

        await expect(health.getReadiness()).resolves.toEqual({
          status: 'degraded',
          dependencies: { postgres: 'ready', redis: 'disabled' },
        })
        expect(metrics.setDependencyReady).toHaveBeenCalledWith({ dependency: 'postgres' }, true)
        expect(metrics.setDependencyReady).toHaveBeenCalledWith({ dependency: 'redis' }, false)
      })

      it('returns 503 when PostgreSQL is down without exposing the error', async () => {
        const prisma = {
          $queryRaw: jest.fn().mockRejectedValue(new Error('private connection detail')),
        }
        const health = new HealthController(
          prisma as unknown as PrismaService,
          makeCache('ready') as unknown as CacheService,
          makeMetrics(),
        )

        await expect(health.getReadiness()).rejects.toMatchObject({
          status: 503,
          response: expect.objectContaining({ status: 'unavailable' }),
        })
        const error = await health.getReadiness().catch((reason: unknown) => reason)
        expect(JSON.stringify(error)).not.toContain('private connection detail')
      })

      it('returns 503 when PostgreSQL does not respond within the bound', async () => {
        jest.useFakeTimers()
        try {
          const prisma = { $queryRaw: jest.fn().mockReturnValue(new Promise(() => undefined)) }
          const health = new HealthController(
            prisma as unknown as PrismaService,
            makeCache('disabled') as unknown as CacheService,
            makeMetrics(),
          )
          const result = health.getReadiness().catch((error: unknown) => error)
          await jest.advanceTimersByTimeAsync(750)
          await expect(result).resolves.toMatchObject({ status: 503 })
        } finally {
          jest.useRealTimers()
        }
      })
    })
  })
})
