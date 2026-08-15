/**
 * Story 6.3 (AC 9, E1): CustomReportVisualizationPanel RTL — five chart
 * choices, compatible display options and inline chart-compatibility errors
 * that never issue preview/save requests (Contract A.10).
 */
import { fireEvent, render, screen } from '@testing-library/react'

import { CustomReportVisualizationPanel } from '../CustomReportVisualizationPanel'
import type { CustomReportCatalog, CustomReportDraft } from '@/lib/custom-report-builder'
import { createEmptyDraft } from '@/lib/custom-report-builder'

const CATALOG: CustomReportCatalog = {
  dataSource: 'DEALS',
  fields: [
    {
      key: 'deal.id',
      label: 'Deal ID',
      valueType: 'STRING',
      roles: ['METRIC'],
      aggregations: ['COUNT', 'DISTINCT_COUNT'],
      filterOperators: [],
      relationKind: null,
      isNumeric: false,
      isCurrency: false,
      isDate: false,
    },
    {
      key: 'deal.createdAt',
      label: 'Created at',
      valueType: 'DATETIME',
      roles: ['FILTER', 'DIMENSION'],
      aggregations: [],
      filterOperators: [],
      relationKind: null,
      isNumeric: false,
      isCurrency: false,
      isDate: true,
    },
    {
      key: 'deal.stage',
      label: 'Stage',
      valueType: 'RELATION',
      roles: ['FILTER', 'DIMENSION'],
      aggregations: [],
      filterOperators: [],
      relationKind: 'STAGE',
      isNumeric: false,
      isCurrency: false,
      isDate: false,
    },
    {
      key: 'deal.value',
      label: 'Value',
      valueType: 'CURRENCY',
      roles: ['FILTER', 'METRIC'],
      aggregations: ['SUM', 'AVERAGE', 'MIN', 'MAX'],
      filterOperators: [],
      relationKind: null,
      isNumeric: true,
      isCurrency: true,
      isDate: false,
    },
  ],
}

function draftFor(chartType: 'TABLE' | 'LINE' | 'BAR' | 'PIE' | 'FUNNEL'): CustomReportDraft {
  const draft = createEmptyDraft()
  draft.source = 'DEALS'
  draft.dimensions = [
    { id: 'dim-1', fieldId: 'deal.createdAt', calculation: null, granularity: 'MONTH' },
  ]
  draft.metrics = [
    { id: 'met-1', fieldId: 'deal.id', aggregation: 'COUNT', alias: 'deals' },
    { id: 'met-2', fieldId: 'deal.value', aggregation: 'SUM', alias: 'revenue' },
  ]
  draft.visualization.type = chartType
  return draft
}

const defaultProps = {
  draft: draftFor('TABLE'),
  catalog: CATALOG,
  onSetChartType: jest.fn(),
  onUpdateVisualization: jest.fn(),
}

function renderPanel(props: Partial<typeof defaultProps> = {}): void {
  render(<CustomReportVisualizationPanel {...defaultProps} {...props} />)
}

describe('CustomReportVisualizationPanel (AC 9, E1)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders the five chart choices', () => {
    renderPanel()
    for (const label of ['Table', 'Line', 'Bar', 'Pie', 'Funnel']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument()
    }
  })

  it('selecting a chart reports the type', () => {
    const onSetChartType = jest.fn()
    renderPanel({ onSetChartType })
    fireEvent.click(screen.getByRole('button', { name: /Bar/ }))
    expect(onSetChartType).toHaveBeenCalledWith('BAR')
  })

  it('renders display options: title, labels, toggles and orientation', () => {
    renderPanel({ draft: draftFor('BAR') })
    expect(screen.getByLabelText('Chart title')).toBeInTheDocument()
    expect(screen.getByLabelText('X axis label')).toBeInTheDocument()
    expect(screen.getByLabelText('Y axis label')).toBeInTheDocument()
    expect(screen.getByLabelText('Show legend')).toBeInTheDocument()
    expect(screen.getByLabelText('Show data labels')).toBeInTheDocument()
    expect(screen.getByLabelText('Orientation')).toBeInTheDocument()
  })

  it('updates display options through the callbacks', () => {
    const onUpdateVisualization = jest.fn()
    renderPanel({ draft: draftFor('BAR'), onUpdateVisualization })
    fireEvent.change(screen.getByLabelText('Chart title'), { target: { value: 'Revenue' } })
    expect(onUpdateVisualization).toHaveBeenCalledWith({ title: 'Revenue' })
    fireEvent.click(screen.getByLabelText('Show data labels'))
    expect(onUpdateVisualization).toHaveBeenCalledWith({ showDataLabels: true })
    fireEvent.change(screen.getByLabelText('Orientation'), { target: { value: 'HORIZONTAL' } })
    expect(onUpdateVisualization).toHaveBeenCalledWith({ orientation: 'HORIZONTAL' })
  })

  it('hides the orientation control for non-BAR charts', () => {
    renderPanel({ draft: draftFor('LINE') })
    expect(screen.queryByLabelText('Orientation')).not.toBeInTheDocument()
  })

  it('shows an inline error for an incompatible chart/config (LINE without date first dim)', () => {
    const draft = draftFor('LINE')
    draft.dimensions[0] = {
      id: 'dim-1',
      fieldId: 'deal.stage',
      calculation: null,
      granularity: null,
    }
    renderPanel({ draft })
    expect(screen.getByText(/Line charts need a date dimension first/)).toBeInTheDocument()
  })

  it('shows an inline error for FUNNEL with a non-Deals source', () => {
    const draft = draftFor('FUNNEL')
    draft.source = 'CONTACTS'
    renderPanel({ draft })
    expect(screen.getByText(/Funnel charts require the Deals source/)).toBeInTheDocument()
  })

  it('shows no errors for a compatible configuration', () => {
    renderPanel({ draft: draftFor('LINE') })
    expect(screen.queryByText(/charts need/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Funnel charts/)).not.toBeInTheDocument()
  })
})
