import type { Request, Response } from 'express'
import { Registry } from 'prom-client'

import { MetricsController, constantTimeEqual } from '../metrics.controller'
import type { ObservabilityOptions } from '../metrics.types'

function makeResponse(): Response {
  return {
    setHeader: jest.fn(),
  } as unknown as Response
}

function makeRequest(authorization?: string): Request {
  return {
    headers: authorization ? { authorization } : {},
  } as unknown as Request
}

describe('MetricsController', () => {
  it('returns 404 when metrics are disabled', async () => {
    const options: ObservabilityOptions = {
      enabled: false,
      buildInfo: { service: 'crm-api', version: 'test', environment: 'test' },
    }
    const controller = new MetricsController(options, new Registry())

    await expect(controller.metrics(makeRequest(), makeResponse())).rejects.toMatchObject({
      status: 404,
    })
  })

  it('requires a bearer token and sets non-cacheable Prometheus headers', async () => {
    const options: ObservabilityOptions = {
      enabled: true,
      scrapeToken: 'secret-token-secret-token-secret-token',
      buildInfo: { service: 'crm-api', version: 'test', environment: 'test' },
    }
    const registry = new Registry()
    const controller = new MetricsController(options, registry)
    const response = makeResponse()

    await expect(
      controller.metrics(makeRequest('Bearer wrong-token'), response),
    ).rejects.toMatchObject({ status: 401 })

    const output = await controller.metrics(
      makeRequest('bearer secret-token-secret-token-secret-token'),
      response,
    )
    expect(typeof output).toBe('string')
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store')
    expect(response.setHeader).toHaveBeenCalledWith('Content-Type', registry.contentType)
  })
})

describe('constantTimeEqual', () => {
  it('compares equal and unequal values without throwing on different lengths', () => {
    expect(constantTimeEqual('same', 'same')).toBe(true)
    expect(constantTimeEqual('same', 'different')).toBe(false)
    expect(constantTimeEqual('', '')).toBe(true)
  })
})
