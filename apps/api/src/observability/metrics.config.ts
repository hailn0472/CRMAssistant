import { ConfigService } from '@nestjs/config'

import type { BuildEnvironmentLabel, BuildInfoOptions, ObservabilityOptions } from './metrics.types'

function parseEnabled(value: string | undefined): boolean {
  return value !== undefined && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function boundedLabel(value: string | undefined, fallback: string): string {
  const normalized = value
    ?.trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 64)
  return normalized || fallback
}

function parseEnvironment(value: string | undefined): BuildEnvironmentLabel {
  const normalized = value?.trim().toLowerCase()
  if (
    normalized === 'development' ||
    normalized === 'test' ||
    normalized === 'staging' ||
    normalized === 'production'
  ) {
    return normalized
  }

  return 'unknown'
}

function createBuildInfo(config: ConfigService): BuildInfoOptions {
  return {
    service: boundedLabel(
      config.get<string>('SERVICE_NAME') ?? process.env.SERVICE_NAME,
      'crm-api',
    ),
    version: boundedLabel(
      config.get<string>('APP_VERSION') ??
        config.get<string>('BUILD_VERSION') ??
        process.env.APP_VERSION ??
        process.env.BUILD_VERSION,
      'unknown',
    ),
    environment: parseEnvironment(config.get<string>('NODE_ENV') ?? process.env.NODE_ENV),
  }
}

export function createObservabilityOptions(config: ConfigService): ObservabilityOptions {
  const enabledValue = config.get<string>('METRICS_ENABLED') ?? process.env.METRICS_ENABLED
  const enabled = parseEnabled(enabledValue)
  const scrapeToken = config.get<string>('METRICS_SCRAPE_TOKEN') ?? process.env.METRICS_SCRAPE_TOKEN

  const normalizedToken = scrapeToken?.trim()
  if (enabled && (!normalizedToken || normalizedToken.length < 32)) {
    throw new Error(
      'METRICS_SCRAPE_TOKEN must be at least 32 characters when METRICS_ENABLED is enabled',
    )
  }

  return {
    enabled,
    scrapeToken: normalizedToken || undefined,
    buildInfo: createBuildInfo(config),
  }
}
