import { PrismaClient } from '@prisma/client'

import { PrismaService } from '../prisma.service'
import type { DatabaseMetricsPort } from '../../observability/metrics.types'

type Middleware = (
  params: { model?: string; action: string; args: unknown },
  next: (params: { model?: string; action: string; args: unknown }) => Promise<unknown>,
) => Promise<unknown>

function makeMetrics(): DatabaseMetricsPort & {
  recordQuery: jest.Mock
  observeQueryDuration: jest.Mock
} {
  return {
    recordQuery: jest.fn(),
    observeQueryDuration: jest.fn(),
  }
}

describe('PrismaService metrics middleware', () => {
  let middleware: Middleware
  let useSpy: jest.SpyInstance

  beforeEach(() => {
    useSpy = jest.spyOn(PrismaClient.prototype, '$use').mockImplementation((callback) => {
      middleware = callback as unknown as Middleware
    })
  })

  afterEach(() => {
    useSpy.mockRestore()
  })

  it.each([
    ['User', 'user'],
    ['Contact', 'contact'],
    ['Task', 'task'],
    ['Message', 'message'],
    ['SensitiveModelWithAnId', 'other'],
  ] as const)('maps %s to the bounded %s group on success', async (model, modelGroup) => {
    const metrics = makeMetrics()
    new PrismaService(metrics)

    await middleware(
      { model, action: 'findMany', args: { where: { id: 'never-recorded' } } },
      async () => ({ ok: true }),
    )

    expect(metrics.recordQuery).toHaveBeenCalledWith({ modelGroup, outcome: 'success' })
    expect(metrics.observeQueryDuration).toHaveBeenCalledWith(
      expect.objectContaining({ modelGroup, outcome: 'success' }),
      expect.any(Number),
    )
  })

  it('records errors without logging SQL or parameters and rethrows', async () => {
    const metrics = makeMetrics()
    new PrismaService(metrics)
    const error = new Error('database unavailable')

    await expect(
      middleware(
        { model: undefined, action: 'queryRaw', args: { query: 'SECRET SQL', params: ['SECRET'] } },
        async () => {
          throw error
        },
      ),
    ).rejects.toBe(error)

    expect(metrics.recordQuery).toHaveBeenCalledWith({ modelGroup: 'other', outcome: 'error' })
    expect(JSON.stringify(metrics.recordQuery.mock.calls)).not.toContain('SECRET')
  })

  it('does not install instrumentation when metrics are omitted for isolated tests', () => {
    new PrismaService()

    expect(useSpy).not.toHaveBeenCalled()
  })
})
