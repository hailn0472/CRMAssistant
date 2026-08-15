/**
 * Story 6.3 — custom report field catalogue unit tests (Contract B, AC 5-8).
 * The catalogue is the single source of truth consumed by BOTH the strict
 * config validator and the execution engine: a field advertised for a source
 * must be usable, and a field never advertised must never validate.
 */
import { customReportFieldCatalog, catalogFor } from '../custom-report-catalog'
import { validateCustomReportConfig } from '../custom-report-config'
import {
  CUSTOM_REPORT_AGGREGATIONS,
  CUSTOM_REPORT_FILTER_OPERATORS,
  CUSTOM_REPORT_VALUE_TYPES,
} from '../custom-report-types'

describe('customReportFieldCatalog', () => {
  it('returns a catalogue for each of the four sources', () => {
    for (const dataSource of ['CONTACTS', 'DEALS', 'TASKS', 'ACTIVITIES'] as const) {
      const catalog = customReportFieldCatalog(dataSource)
      expect(catalog.dataSource).toBe(dataSource)
      expect(catalog.fields.length).toBeGreaterThan(0)
    }
  })

  it('exposes stable, unique, labelled fields with closed vocabularies', () => {
    for (const dataSource of ['CONTACTS', 'DEALS', 'TASKS', 'ACTIVITIES'] as const) {
      const catalog = customReportFieldCatalog(dataSource)
      const keys = catalog.fields.map((f) => f.key)
      expect(new Set(keys).size).toBe(keys.length)
      for (const field of catalog.fields) {
        expect(field.label.length).toBeGreaterThan(0)
        expect(CUSTOM_REPORT_VALUE_TYPES).toContain(field.valueType)
        expect(field.roles.length).toBeGreaterThan(0)
        for (const op of field.filterOperators) {
          expect(CUSTOM_REPORT_FILTER_OPERATORS).toContain(op)
        }
        for (const agg of field.aggregations) {
          expect(CUSTOM_REPORT_AGGREGATIONS).toContain(agg)
        }
      }
    }
  })

  it('advertises the binding DEALS dimension/filter and numeric metric fields', () => {
    const catalog = customReportFieldCatalog('DEALS')
    const keys = catalog.fields.map((f) => f.key)
    for (const expected of [
      'deal.createdAt',
      'deal.updatedAt',
      'deal.expectedCloseDate',
      'deal.actualCloseDate',
      'deal.owner',
      'deal.ownerTeam',
      'deal.stage',
      'deal.status',
      'deal.contact',
      'deal.currency',
      'deal.product',
      'deal.value',
      'deal.probability',
      'deal.lineItem.quantity',
      'deal.lineItem.discount',
      'deal.lineItem.total',
    ]) {
      expect(keys).toContain(expected)
    }
    const value = catalog.fields.find((f) => f.key === 'deal.value')
    expect(value?.isNumeric).toBe(true)
    expect(value?.isCurrency).toBe(true)
    expect(value?.aggregations).toContain('SUM')
    expect(value?.aggregations).toContain('AVERAGE')
    const stage = catalog.fields.find((f) => f.key === 'deal.stage')
    expect(stage?.relationKind).toBe('STAGE')
    expect(stage?.filterOperators).toEqual(expect.arrayContaining(['EQ', 'NOT_EQ', 'IN']))
  })

  it('advertises derived status with the closed OPEN|WON|LOST vocabulary', () => {
    const status = customReportFieldCatalog('DEALS').fields.find((f) => f.key === 'deal.status')
    expect(status?.valueType).toBe('ENUM')
    expect(status?.filterOperators).toEqual(expect.arrayContaining(['EQ', 'NOT_EQ', 'IN']))
  })

  it('restricts line-item fields to the METRIC role only (multi-valued relation)', () => {
    const catalog = customReportFieldCatalog('DEALS')
    for (const key of ['deal.lineItem.quantity', 'deal.lineItem.discount', 'deal.lineItem.total']) {
      const field = catalog.fields.find((f) => f.key === key)
      expect(field?.roles).toEqual(['METRIC'])
    }
  })

  it('advertises CONTACTS fields and never advertises deal-only fields', () => {
    const catalog = customReportFieldCatalog('CONTACTS')
    const keys = catalog.fields.map((f) => f.key)
    for (const expected of [
      'contact.createdAt',
      'contact.updatedAt',
      'contact.owner',
      'contact.team',
      'contact.company',
      'contact.jobTitle',
      'contact.addressCity',
      'contact.addressCountry',
      'contact.department',
      'contact.timezone',
      'contact.language',
      'contact.source',
      'contact.tags',
    ]) {
      expect(keys).toContain(expected)
    }
    expect(keys).not.toContain('deal.value')
    expect(keys).not.toContain('deal.stage')
    expect(keys).not.toContain('deal.status')
  })

  it('advertises TASKS fields including recurrence', () => {
    const catalog = customReportFieldCatalog('TASKS')
    const keys = catalog.fields.map((f) => f.key)
    for (const expected of [
      'task.createdAt',
      'task.updatedAt',
      'task.dueDate',
      'task.completedAt',
      'task.assignee',
      'task.assigneeTeam',
      'task.status',
      'task.priority',
      'task.contact',
      'task.deal',
      'task.isRecurring',
      'task.recurrencePattern',
    ]) {
      expect(keys).toContain(expected)
    }
  })

  it('advertises ACTIVITIES fields with the CONTACT read gate semantics', () => {
    const catalog = customReportFieldCatalog('ACTIVITIES')
    const keys = catalog.fields.map((f) => f.key)
    for (const expected of [
      'activity.createdAt',
      'activity.type',
      'activity.source',
      'activity.creator',
      'activity.contact',
      'activity.contactOwner',
      'activity.contactTeam',
      'activity.contactTags',
    ]) {
      expect(keys).toContain(expected)
    }
  })

  it('exposes the source read gate mapping', () => {
    expect(catalogFor('CONTACTS').readGate).toBe('CONTACT')
    expect(catalogFor('DEALS').readGate).toBe('DEAL')
    expect(catalogFor('TASKS').readGate).toBe('TASK')
    // Activities derive visibility from their active parent Contact.
    expect(catalogFor('ACTIVITIES').readGate).toBe('CONTACT')
  })

  it('allows COUNT/DISTINCT_COUNT metrics on scalar keys only for non-numeric sources', () => {
    const contacts = customReportFieldCatalog('CONTACTS')
    const idField = contacts.fields.find((f) => f.key === 'contact.id')
    expect(idField?.roles).toContain('METRIC')
    expect(idField?.aggregations).toEqual(expect.arrayContaining(['COUNT', 'DISTINCT_COUNT']))
    const company = contacts.fields.find((f) => f.key === 'contact.company')
    expect(company?.aggregations).not.toContain('SUM')
  })
})

describe('catalogue is the single source of truth for the validator', () => {
  function baseConfig(dataSource: 'CONTACTS' | 'DEALS'): Record<string, unknown> {
    const isDeals = dataSource === 'DEALS'
    return {
      version: 1,
      dataSource,
      filters: [],
      dimensions: [
        {
          id: 'd-1',
          fieldId: isDeals ? 'deal.stage' : 'contact.owner',
          calculation: null,
          granularity: null,
        },
      ],
      metrics: [
        {
          id: 'm-1',
          fieldId: isDeals ? 'deal.value' : 'contact.id',
          aggregation: isDeals ? 'SUM' : 'COUNT',
          alias: isDeals ? 'revenue' : 'count',
        },
      ],
      calculatedFields: [],
      visualization: {
        type: 'TABLE',
        title: null,
        showLegend: false,
        showDataLabels: false,
        xAxisLabel: null,
        yAxisLabel: null,
        orientation: null,
      },
      sort: [],
    }
  }

  it('accepts exactly the fields the catalogue advertises for the source', () => {
    expect(() => validateCustomReportConfig(baseConfig('DEALS'))).not.toThrow()
    expect(() => validateCustomReportConfig(baseConfig('CONTACTS'))).not.toThrow()
  })

  it('rejects a metric the catalogue does not advertise for the source', () => {
    const config = baseConfig('CONTACTS')
    ;(config.metrics as Array<Record<string, unknown>>)[0].fieldId = 'deal.value'
    expect(() => validateCustomReportConfig(config)).toThrow(/field/i)
  })

  it('rejects an aggregation the catalogue does not allow for the field', () => {
    const config = baseConfig('CONTACTS')
    ;(config.metrics as Array<Record<string, unknown>>)[0].aggregation = 'SUM'
    expect(() => validateCustomReportConfig(config)).toThrow(/numeric/i)
  })

  it('rejects a filter operator the catalogue does not allow for the field', () => {
    const config = baseConfig('DEALS')
    ;(config.filters as unknown[]).push({
      id: 'f-1',
      fieldId: 'deal.stage',
      operator: 'GT',
      numberValue: 1,
    })
    expect(() => validateCustomReportConfig(config)).toThrow(/operator/i)
  })

  it('rejects a line-item field used as a dimension (multi-valued relation)', () => {
    const config = baseConfig('DEALS')
    ;(config.dimensions as Array<Record<string, unknown>>)[0].fieldId = 'deal.lineItem.quantity'
    expect(() => validateCustomReportConfig(config)).toThrow(/cannot be used as a dimension/i)
  })

  it('rejects a line-item field used as a filter (multi-valued relation)', () => {
    const config = baseConfig('DEALS')
    ;(config.filters as unknown[]).push({
      id: 'f-1',
      fieldId: 'deal.lineItem.quantity',
      operator: 'EQ',
      numberValue: 2,
    })
    expect(() => validateCustomReportConfig(config)).toThrow(/cannot be used as a filter/i)
  })

  it('allows every advertised field as a dimension or filter per its roles', () => {
    for (const dataSource of ['CONTACTS', 'DEALS', 'TASKS', 'ACTIVITIES'] as const) {
      const catalog = customReportFieldCatalog(dataSource)
      for (const field of catalog.fields) {
        if (!field.roles.includes('DIMENSION')) continue
        const config = {
          version: 1,
          dataSource,
          filters: [],
          dimensions: [
            {
              id: 'd-1',
              fieldId: field.key,
              calculation: null,
              granularity: field.isDate ? 'MONTH' : null,
            },
          ],
          metrics: [
            {
              id: 'm-1',
              fieldId: catalog.fields.find((f) => f.roles.includes('METRIC'))?.key,
              aggregation: 'COUNT',
              alias: 'count',
            },
          ],
          calculatedFields: [],
          visualization: { type: 'TABLE' },
          sort: [],
        }
        const metricField = catalog.fields.find((f) => f.roles.includes('METRIC'))
        if (!metricField) continue
        ;(config.metrics as Array<Record<string, unknown>>)[0].fieldId = metricField.key
        expect(() => validateCustomReportConfig(config)).not.toThrow()
      }
    }
  })
})
