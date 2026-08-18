/**
 * Story 6.3 & 6.4 (AC 10, E2, E6): CustomReportPreview RTL — validation, loading,
 * refreshing, backend error, empty and data states plus the accessible chart
 * contract (role="img", legend, tooltip, sr-only table with EVERY datum).
 */
jest.mock('recharts', () => {
  const React = require('react')
  const MockContainer = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children)
  const MockTooltip = ({
    content,
  }: {
    content?: React.ReactElement | React.ComponentType<Record<string, unknown>>
  }) => {
    const props = {
      active: true,
      payload: [{ value: 100, payload: { label: 'Proposal', value: 100 } }],
    }
    if (!content) return React.createElement('div')
    if (typeof content === 'function') return React.createElement(content, props)
    return React.cloneElement(content, props)
  }
  return {
    ResponsiveContainer: MockContainer,
    LineChart: MockContainer,
    Line: () => React.createElement('div'),
    BarChart: MockContainer,
    Bar: () => React.createElement('div'),
    PieChart: MockContainer,
    Pie: () => React.createElement('div'),
    FunnelChart: MockContainer,
    Funnel: () => React.createElement('div'),
    FunnelDataKey: null,
    Cell: () => React.createElement('div'),
    LabelList: () => React.createElement('div'),
    XAxis: () => React.createElement('div'),
    YAxis: () => React.createElement('div'),
    CartesianGrid: () => React.createElement('div'),
    Tooltip: (props: Record<string, unknown>) => React.createElement(MockTooltip, props),
    Legend: () => React.createElement('div'),
  }
})

import { fireEvent, render, screen } from '@testing-library/react'

import { CustomReportPreview } from '../CustomReportPreview'
import type { CustomReportResult } from '@/services/custom-report.service'
import type { CustomReportDraft } from '@/lib/custom-report-builder'
import { createEmptyDraft, validateDraft } from '@/lib/custom-report-builder'

const CATALOG = null

const VALID_DRAFT: CustomReportDraft = {
  source: 'DEALS',
  filters: [],
  dimensions: [{ id: 'dim-1', fieldId: 'deal.createdAt', calculation: null, granularity: 'MONTH' }],
  metrics: [{ id: 'met-1', fieldId: 'deal.id', aggregation: 'COUNT', alias: 'deals' }],
  calculatedFields: [],
  visualization: {
    type: 'TABLE',
    title: 'Deals by month',
    showLegend: true,
    showDataLabels: false,
    xAxisLabel: null,
    yAxisLabel: null,
    orientation: 'VERTICAL',
    colors: ['BLUE', 'VIOLET'],
    legendPosition: 'BOTTOM',
  },
  sort: [],
}

const RESULT: CustomReportResult = {
  reportId: null,
  generatedAt: '2026-08-16T12:00:00.000Z',
  config: VALID_DRAFT as never,
  columns: [
    {
      fieldId: 'deal.createdAt',
      label: 'Created at',
      valueType: 'DATETIME',
      role: 'DIMENSION',
      aggregation: null,
      granularity: 'MONTH',
      isCalculated: false,
    },
    {
      fieldId: 'deal.id',
      label: 'Deal ID',
      valueType: 'STRING',
      role: 'METRIC',
      aggregation: 'COUNT',
      granularity: null,
      isCalculated: false,
    },
  ],
  rows: [
    {
      key: '2026-08',
      cells: [
        {
          fieldId: 'deal.createdAt',
          label: 'Created at',
          valueType: 'DATETIME',
          stringValue: null,
          numberValue: null,
          booleanValue: null,
          dateValue: '2026-08-01',
          isNull: false,
        },
        {
          fieldId: 'deal.id',
          label: 'Deal ID',
          valueType: 'STRING',
          stringValue: '3',
          numberValue: null,
          booleanValue: null,
          dateValue: null,
          isNull: false,
        },
      ],
    },
  ],
  totalRows: 1,
  series: [
    {
      metricId: 'met-1',
      label: 'Deals',
      points: [
        { key: '2026-08', label: 'Aug 2026', value: 3, dimensionLabels: ['Aug 2026'] },
        { key: '2026-09', label: 'Sep 2026', value: 5, dimensionLabels: ['Sep 2026'] },
      ],
    },
  ],
  warnings: [{ code: 'DIVISION_BY_ZERO', message: 'Division by zero in avg_deal_size — null.' }],
  pagination: { page: 1, pageSize: 50, totalPages: 1 },
  truncated: false,
}

const defaultProps = {
  draft: VALID_DRAFT,
  catalog: CATALOG,
  validation: validateDraft(VALID_DRAFT, CATALOG),
  result: null as CustomReportResult | null,
  isLoading: false,
  isRefreshing: false,
  isError: false,
  errorMessage: null as string | null,
  onRetry: jest.fn(),
}

function renderPreview(props: Partial<typeof defaultProps> = {}): void {
  render(<CustomReportPreview {...defaultProps} {...props} />)
}

describe('CustomReportPreview (AC 10, E2/E6)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('shows the validation state with errors instead of requesting (invalid drafts never fire)', () => {
    const empty = createEmptyDraft()
    renderPreview({ draft: empty, validation: validateDraft(empty, CATALOG) })
    expect(screen.getByText(/Choose a data source/)).toBeInTheDocument()
    expect(screen.getByText(/Add at least one dimension/)).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('shows the loading skeleton on the initial load', () => {
    renderPreview({ isLoading: true, result: null })
    expect(screen.getByText(/Loading preview/)).toBeInTheDocument()
  })

  it('shows the backend error state with a retry action', () => {
    const onRetry = jest.fn()
    renderPreview({
      isError: true,
      errorMessage: 'Missing required permission: DEAL:READ',
      onRetry,
    })
    expect(screen.getByText(/Missing required permission: DEAL:READ/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }))
    expect(onRetry).toHaveBeenCalled()
  })

  it('shows the empty state for a valid config with zero rows', () => {
    renderPreview({
      result: { ...RESULT, rows: [], totalRows: 0, series: [] },
    })
    expect(screen.getByText(/No rows/)).toBeInTheDocument()
  })

  it('renders a semantic HTML table for TABLE visualizations', () => {
    renderPreview({ result: RESULT })
    const table = screen.getByRole('table')
    expect(table).toHaveAttribute('aria-label', expect.stringContaining('Deals by month'))
    expect(screen.getByRole('columnheader', { name: 'Created at' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '3' })).toBeInTheDocument()
  })

  it('renders line charts with role="img", legend and a complete sr-only table', () => {
    const draft = {
      ...VALID_DRAFT,
      visualization: { ...VALID_DRAFT.visualization, type: 'LINE' as const },
    }
    const result = {
      ...RESULT,
      config: {
        ...RESULT.config,
        visualization: { ...RESULT.config.visualization, type: 'LINE' as const },
      },
    }
    renderPreview({ draft, result })
    expect(screen.getByRole('img')).toBeInTheDocument()
    expect(screen.getByRole('toolbar', { name: 'Toggle series visibility' })).toBeInTheDocument()
    const srTable = screen.getByRole('table', { hidden: true })
    expect(srTable).toBeInTheDocument()
    expect(srTable.textContent).toContain('Aug 2026')
    expect(srTable.textContent).toContain('Sep 2026')
  })

  it('renders bar, pie and funnel charts with sr-only tables', () => {
    for (const type of ['BAR', 'PIE', 'FUNNEL'] as const) {
      const draft = { ...VALID_DRAFT, visualization: { ...VALID_DRAFT.visualization, type } }
      const result = {
        ...RESULT,
        config: { ...RESULT.config, visualization: { ...RESULT.config.visualization, type } },
      }
      const { unmount } = render(
        <CustomReportPreview {...defaultProps} draft={draft} result={result} />,
      )
      expect(screen.getByRole('img')).toBeInTheDocument()
      expect(screen.getByRole('table', { hidden: true }).textContent).toContain('Aug 2026')
      unmount()
    }
  })

  it('shows warnings (e.g. division by zero) in a visible banner', () => {
    renderPreview({ result: RESULT })
    expect(screen.getByText(/Division by zero in avg_deal_size/)).toBeInTheDocument()
  })

  it('shows the generated-at footer and pagination summary', () => {
    renderPreview({ result: RESULT })
    expect(screen.getByText(/Generated/)).toBeInTheDocument()
    expect(screen.getByText(/Page 1 of 1/)).toBeInTheDocument()
  })

  it('preserves the last successful preview while refreshing (placeholder semantics)', () => {
    renderPreview({ result: RESULT, isRefreshing: true })
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText(/Refreshing/)).toBeInTheDocument()
  })
})
