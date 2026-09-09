import { EventEmitter } from 'node:events'
import type { NextFunction, Request, Response } from 'express'

import {
  buildHttpMetricLabels,
  HttpMetricsMiddleware,
  normalizeHttpMethod,
  normalizeHttpRoute,
  normalizeHttpStatusClass,
} from '../http-metrics.middleware'
import type { HttpMetricsPort } from '../metrics.types'

function makeRequest(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    path: '/contacts/contact-id-123',
    baseUrl: '',
    route: undefined,
    ...overrides,
  } as Request
}

function makeResponse(statusCode = 200): Response & EventEmitter {
  const response = new EventEmitter() as Response & EventEmitter
  Object.defineProperty(response, 'statusCode', { value: statusCode, writable: true })
  return response
}

describe('HTTP metrics normalization', () => {
  it('maps methods and statuses to closed sets', () => {
    expect(normalizeHttpMethod('get')).toBe('GET')
    expect(normalizeHttpMethod('OPTIONS')).toBe('OTHER')
    expect(normalizeHttpStatusClass(204)).toBe('2xx')
    expect(normalizeHttpStatusClass(503)).toBe('5xx')
    expect(normalizeHttpStatusClass(700)).toBe('other')
  })

  it('groups dynamic paths without exposing IDs or query strings', () => {
    const request = makeRequest({ path: '/contacts/contact-id-123?email=private@example.com' })
    expect(normalizeHttpRoute(request)).toBe('/contacts')
    expect(buildHttpMetricLabels(request, makeResponse(200))).toEqual({
      method: 'GET',
      route: '/contacts',
      statusClass: '2xx',
    })
  })

  it('groups legacy health and Facebook webhook routes into bounded labels', () => {
    expect(normalizeHttpRoute(makeRequest({ path: '/health' }))).toBe('/health/live')
    expect(normalizeHttpRoute(makeRequest({ path: '/webhooks/facebook' }))).toBe('/facebook')
    expect(normalizeHttpRoute(makeRequest({ path: '/api/contacts/import/private-id' }))).toBe(
      '/contacts',
    )
  })
})

describe('HttpMetricsMiddleware', () => {
  it('records a request once when finish and close both fire', () => {
    const recordRequest = jest.fn()
    const observeRequestDuration = jest.fn()
    const metrics: HttpMetricsPort = { recordRequest, observeRequestDuration }
    const middleware = new HttpMetricsMiddleware(metrics)
    const request = makeRequest({ method: 'POST', path: '/auth/login' })
    const response = makeResponse(201)
    const next = jest.fn() as NextFunction

    middleware.use(request, response, next)
    response.emit('finish')
    response.emit('close')

    expect(next).toHaveBeenCalledTimes(1)
    expect(recordRequest).toHaveBeenCalledTimes(1)
    expect(recordRequest).toHaveBeenCalledWith({
      method: 'POST',
      route: '/auth',
      statusClass: '2xx',
    })
    expect(observeRequestDuration).toHaveBeenCalledTimes(1)
    expect(observeRequestDuration.mock.calls[0]?.[1]).toEqual(expect.any(Number))
  })

  it('does not let a metrics adapter failure escape response events', () => {
    const metrics: HttpMetricsPort = {
      recordRequest: jest.fn(() => {
        throw new Error('counter unavailable')
      }),
      observeRequestDuration: jest.fn(() => {
        throw new Error('histogram unavailable')
      }),
    }
    const middleware = new HttpMetricsMiddleware(metrics)
    const response = makeResponse(200)

    middleware.use(makeRequest(), response, jest.fn())

    expect(() => response.emit('finish')).not.toThrow()
  })
})
