import request from 'supertest'

import { ApiTestHarness, TEST_METRICS_TOKEN } from './api-test-harness'

describe('Observability API', () => {
  let harness: ApiTestHarness

  beforeAll(async () => {
    harness = await ApiTestHarness.start({ metricsEnabled: true })
  })

  afterAll(async () => {
    await harness.stop()
  })

  afterEach(async () => {
    await harness.cleanupDatabase()
  })

  it('rejects missing and invalid metrics credentials without exposing the token', async () => {
    const server = harness.app.getHttpServer()
    const missing = await request(server).get('/metrics')
    const invalid = await request(server)
      .get('/metrics')
      .set('Authorization', 'Bearer definitely-not-the-test-token')

    expect(missing.status).toBe(401)
    expect(invalid.status).toBe(401)
    expect(missing.text).not.toContain(TEST_METRICS_TOKEN)
    expect(invalid.text).not.toContain(TEST_METRICS_TOKEN)
  })

  it('serves authorized Prometheus content without secrets, PII, or unbounded route labels', async () => {
    const server = harness.app.getHttpServer()
    const sensitiveValue = 'customer-private-email@example.com'

    await request(server).get(`/health/ready?contactId=${sensitiveValue}`).expect(200)
    await request(server).get(`/unknown/${sensitiveValue}`).expect(404)

    const response = await request(server)
      .get('/metrics')
      .set('Authorization', `Bearer ${TEST_METRICS_TOKEN}`)
      .expect(200)

    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers['content-type']).toContain('text/plain')
    expect(response.text).toContain('crm_http_requests_total')
    expect(response.text).toContain('crm_dependency_ready{dependency="postgres"} 1')
    expect(response.text).toContain('crm_dependency_ready{dependency="redis"} 0')
    expect(response.text).toContain('crm_build_info')
    expect(response.text).toMatch(/crm_process_[a-z0-9_]+/)
    expect(response.text).toContain('route="/health/ready"')
    const routeLabels = [...response.text.matchAll(/route="([^"]+)"/g)].map((match) => match[1])
    expect(
      routeLabels.every((route) =>
        [
          '/health/live',
          '/health/ready',
          '/metrics',
          '/graphql',
          '/auth',
          '/contacts',
          '/tasks',
          '/facebook',
          'other',
        ].includes(route),
      ),
    ).toBe(true)
    expect(response.text).not.toContain(TEST_METRICS_TOKEN)
    expect(response.text).not.toContain(sensitiveValue)
    expect(response.text).not.toContain('customer-private-email')
    expect(response.text).not.toMatch(/route="[^"]*(?:customer|private|email@example\.com)/i)
    expect(response.text).not.toContain('access_token=')
  })
})
