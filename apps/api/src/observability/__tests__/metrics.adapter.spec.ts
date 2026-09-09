import { Registry } from 'prom-client'

import { PrometheusMetricsAdapter } from '../metrics.adapter'

describe('PrometheusMetricsAdapter', () => {
  it('collects default and application metrics in the custom registry', async () => {
    const registry = new Registry()
    const adapter = new PrometheusMetricsAdapter(registry)

    adapter.recordRequest({ method: 'GET', route: '/health/live', statusClass: '2xx' })
    adapter.observeRequestDuration(
      { method: 'GET', route: '/health/live', statusClass: '2xx' },
      0.012,
    )
    adapter.recordCacheOperation({
      operation: 'get',
      outcome: 'success',
    })
    adapter.recordWebhookEvent({ eventGroup: 'message', outcome: 'success' })
    adapter.recordGraphRequest({ operationGroup: 'read', outcome: 'success' })
    adapter.setDependencyReady({ dependency: 'postgres' }, true)
    adapter.recordJob({ jobGroup: 'import', outcome: 'success' })
    adapter.observeJobDuration({ jobGroup: 'import', outcome: 'success' }, 0.2)

    const output = await registry.metrics()
    expect(output).toContain('crm_http_requests_total')
    expect(output).toContain('crm_cache_operations_total')
    expect(output).toContain('crm_facebook_webhook_events_total')
    expect(output).toContain('crm_dependency_ready')
    expect(output).toContain('crm_background_jobs_total')
    expect(output).toContain('crm_build_info')
    expect(output).toContain('crm_process_cpu_user_seconds_total')
  })

  it('does not duplicate metric registration on repeated adapter construction', async () => {
    const registry = new Registry()
    new PrometheusMetricsAdapter(registry)
    new PrometheusMetricsAdapter(registry)

    const names = (await registry.getMetricsAsJSON()).map((metric) => metric.name)
    expect(new Set(names).size).toBe(names.length)
  })
})
