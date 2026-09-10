import { ConfigService } from '@nestjs/config'

import { createObservabilityOptions } from '../metrics.config'

function config(values: Record<string, string | undefined>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService
}

describe('createObservabilityOptions', () => {
  it('is disabled unless explicitly opted in', () => {
    expect(createObservabilityOptions(config({}))).toEqual({
      enabled: false,
      buildInfo: {
        service: 'crm-api',
        version: 'unknown',
        environment: 'test',
      },
    })
  })

  it('requires a scrape token when enabled', () => {
    expect(() => createObservabilityOptions(config({ METRICS_ENABLED: 'true' }))).toThrow(
      'METRICS_SCRAPE_TOKEN must be at least 32 characters',
    )
  })

  it('normalizes enabled values and trims the token', () => {
    expect(
      createObservabilityOptions(
        config({
          METRICS_ENABLED: ' ON ',
          METRICS_SCRAPE_TOKEN: '  scrape-secret-scrape-secret-scrape-secret  ',
        }),
      ),
    ).toEqual({
      enabled: true,
      scrapeToken: 'scrape-secret-scrape-secret-scrape-secret',
      buildInfo: {
        service: 'crm-api',
        version: 'unknown',
        environment: 'test',
      },
    })
  })
})
