import { Global, Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import type { Registry } from 'prom-client'

import { PrometheusMetricsAdapter } from './metrics.adapter'
import { createObservabilityOptions } from './metrics.config'
import { MetricsController } from './metrics.controller'
import { NoopMetricsAdapter } from './metrics.noop'
import { getMetricsRegistry } from './metrics.registry'
import {
  CACHE_METRICS_PORT,
  BACKGROUND_METRICS_PORT,
  DATABASE_METRICS_PORT,
  DEPENDENCY_METRICS_PORT,
  FACEBOOK_METRICS_PORT,
  GRAPHQL_METRICS_PORT,
  HTTP_METRICS_PORT,
  METRICS_ADAPTER,
  METRICS_OPTIONS,
  METRICS_REGISTRY,
  type ObservabilityOptions,
} from './metrics.types'

@Global()
@Module({
  imports: [ConfigModule],
  controllers: [MetricsController],
  providers: [
    {
      provide: METRICS_OPTIONS,
      inject: [ConfigService],
      useFactory: createObservabilityOptions,
    },
    {
      provide: METRICS_REGISTRY,
      useFactory: getMetricsRegistry,
    },
    {
      provide: METRICS_ADAPTER,
      inject: [METRICS_OPTIONS, METRICS_REGISTRY],
      useFactory: (
        options: ObservabilityOptions,
        registry: Registry,
      ): PrometheusMetricsAdapter | NoopMetricsAdapter =>
        options.enabled
          ? new PrometheusMetricsAdapter(registry, options.buildInfo)
          : new NoopMetricsAdapter(),
    },
    {
      provide: HTTP_METRICS_PORT,
      useExisting: METRICS_ADAPTER,
    },
    {
      provide: GRAPHQL_METRICS_PORT,
      useExisting: METRICS_ADAPTER,
    },
    {
      provide: DATABASE_METRICS_PORT,
      useExisting: METRICS_ADAPTER,
    },
    {
      provide: CACHE_METRICS_PORT,
      useExisting: METRICS_ADAPTER,
    },
    {
      provide: FACEBOOK_METRICS_PORT,
      useExisting: METRICS_ADAPTER,
    },
    {
      provide: DEPENDENCY_METRICS_PORT,
      useExisting: METRICS_ADAPTER,
    },
    {
      provide: BACKGROUND_METRICS_PORT,
      useExisting: METRICS_ADAPTER,
    },
  ],
  exports: [
    METRICS_OPTIONS,
    METRICS_REGISTRY,
    HTTP_METRICS_PORT,
    GRAPHQL_METRICS_PORT,
    DATABASE_METRICS_PORT,
    CACHE_METRICS_PORT,
    FACEBOOK_METRICS_PORT,
    DEPENDENCY_METRICS_PORT,
    BACKGROUND_METRICS_PORT,
  ],
})
export class ObservabilityModule {}
