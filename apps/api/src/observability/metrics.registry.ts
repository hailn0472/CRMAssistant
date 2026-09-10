import { collectDefaultMetrics, Registry } from 'prom-client'

const GLOBAL_REGISTRY_KEY = '__crm_assistant_metrics_registry__'
const DEFAULT_METRICS_INITIALIZED_KEY = '__crm_assistant_default_metrics_initialized__'

type RegistryWithState = Registry & {
  [DEFAULT_METRICS_INITIALIZED_KEY]?: boolean
}

type GlobalWithRegistry = typeof globalThis & {
  [GLOBAL_REGISTRY_KEY]?: RegistryWithState
}

const globalState = globalThis as GlobalWithRegistry

/**
 * The registry lives on globalThis so Jest module resets and hot reload do not
 * create a second registry or re-register the same metric names.
 */
export function getMetricsRegistry(): Registry {
  if (!globalState[GLOBAL_REGISTRY_KEY]) {
    globalState[GLOBAL_REGISTRY_KEY] = new Registry() as RegistryWithState
  }

  return globalState[GLOBAL_REGISTRY_KEY]
}

export function ensureDefaultMetrics(registry: Registry): void {
  const statefulRegistry = registry as RegistryWithState
  if (statefulRegistry[DEFAULT_METRICS_INITIALIZED_KEY]) {
    return
  }

  collectDefaultMetrics({
    register: registry,
    prefix: 'crm_',
  })
  statefulRegistry[DEFAULT_METRICS_INITIALIZED_KEY] = true
}

export function getOrCreateMetric<T>(registry: Registry, name: string, factory: () => T): T {
  const existing = registry.getSingleMetric(name)
  return (existing as T | undefined) ?? factory()
}
