/**
 * Story 6.3 (AC 6-8, 13-14, E1, E8): CustomReportFieldsPanel RTL.
 * Searchable palette, Dimensions/Metrics drop zones, aggregation/granularity
 * controls, calculated-field editor, and the non-drag Add/Remove/Move
 * equivalents that make every workflow keyboard-accessible (Contract D.26).
 */
import { fireEvent, render, screen, within } from '@testing-library/react'

import { CustomReportFieldsPanel } from '../CustomReportFieldsPanel'
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
      key: 'deal.status',
      label: 'Status',
      valueType: 'ENUM',
      roles: ['FILTER', 'DIMENSION'],
      aggregations: [],
      filterOperators: [],
      relationKind: null,
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
    {
      key: 'deal.probability',
      label: 'Probability',
      valueType: 'NUMBER',
      roles: ['FILTER', 'METRIC'],
      aggregations: ['SUM', 'AVERAGE', 'MIN', 'MAX'],
      filterOperators: [],
      relationKind: null,
      isNumeric: true,
      isCurrency: false,
      isDate: false,
    },
  ],
}

function draftWithSelections(): CustomReportDraft {
  const draft = createEmptyDraft()
  draft.source = 'DEALS'
  draft.dimensions = [
    { id: 'dim-1', fieldId: 'deal.createdAt', calculation: null, granularity: 'MONTH' },
    { id: 'dim-2', fieldId: 'deal.stage', calculation: null, granularity: null },
  ]
  draft.metrics = [
    { id: 'met-1', fieldId: 'deal.id', aggregation: 'COUNT', alias: 'deals' },
    { id: 'met-2', fieldId: 'deal.value', aggregation: 'SUM', alias: 'revenue' },
  ]
  return draft
}

const defaultProps: {
  draft: CustomReportDraft
  catalog: CustomReportCatalog | null
  catalogLoading: boolean
  catalogError: string | null
  onAddDimension: jest.Mock
  onAddMetric: jest.Mock
  onAddCountMetric: jest.Mock
  onRemoveItem: jest.Mock
  onMoveItem: jest.Mock
  onSetAggregation: jest.Mock
  onSetGranularity: jest.Mock
  onAddCalculatedField: jest.Mock
  onRemoveCalculatedField: jest.Mock
  onReorderItems: jest.Mock
  onAddSort: jest.Mock
  onRemoveSort: jest.Mock
  onSetSortDirection: jest.Mock
  onMoveSort: jest.Mock
} = {
  draft: createEmptyDraft(),
  catalog: CATALOG,
  catalogLoading: false,
  catalogError: null,
  onAddDimension: jest.fn(),
  onAddMetric: jest.fn(),
  onAddCountMetric: jest.fn(),
  onRemoveItem: jest.fn(),
  onMoveItem: jest.fn(),
  onSetAggregation: jest.fn(),
  onSetGranularity: jest.fn(),
  onAddCalculatedField: jest.fn(),
  onRemoveCalculatedField: jest.fn(),
  onReorderItems: jest.fn(),
  onAddSort: jest.fn(),
  onRemoveSort: jest.fn(),
  onSetSortDirection: jest.fn(),
  onMoveSort: jest.fn(),
}

function renderPanel(props: Partial<typeof defaultProps> = {}): void {
  render(<CustomReportFieldsPanel {...defaultProps} {...props} />)
}

describe('CustomReportFieldsPanel (AC 6-8, 13-14)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders the palette with searchable available fields', () => {
    renderPanel({ draft: draftWithSelections() })
    const palette = screen.getByLabelText('Available fields')
    expect(within(palette).getByText('Value')).toBeInTheDocument()
    expect(within(palette).getByText('Probability')).toBeInTheDocument()
  })

  it('filters the palette by search query', () => {
    renderPanel({ draft: draftWithSelections() })
    const palette = screen.getByLabelText('Available fields')
    const search = screen.getByPlaceholderText(/Search available fields/)
    fireEvent.change(search, { target: { value: 'prob' } })
    expect(within(palette).getByText('Probability')).toBeInTheDocument()
    expect(within(palette).queryByText('Value')).not.toBeInTheDocument()
    expect(within(palette).queryByText('Stage')).not.toBeInTheDocument()
  })

  it('provides Add as dimension and Add as metric buttons on palette items (AC 6, D.26)', () => {
    const onAddDimension = jest.fn()
    const onAddMetric = jest.fn()
    renderPanel({ draft: draftWithSelections(), onAddDimension, onAddMetric })
    fireEvent.click(screen.getByRole('button', { name: 'Add Stage as dimension' }))
    expect(onAddDimension).toHaveBeenCalledWith('deal.stage')
    fireEvent.click(screen.getByRole('button', { name: 'Add Value as metric' }))
    expect(onAddMetric).toHaveBeenCalledWith('deal.value', 'SUM')
  })

  it('does not offer metric role for dimension-only fields', () => {
    renderPanel({ draft: draftWithSelections() })
    expect(screen.queryByRole('button', { name: 'Add Stage as metric' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Add Created at as metric' }),
    ).not.toBeInTheDocument()
  })

  it('renders the two drop zones with counts and selected items', () => {
    renderPanel({ draft: draftWithSelections() })
    const dimensions = screen.getByLabelText('Dimensions drop zone')
    expect(within(dimensions).getByText('Created at')).toBeInTheDocument()
    expect(within(dimensions).getByText('Stage')).toBeInTheDocument()
    const metrics = screen.getByLabelText('Metrics drop zone')
    expect(within(metrics).getByText('Deal ID')).toBeInTheDocument()
    expect(within(metrics).getByText('Value')).toBeInTheDocument()
  })

  it('provides Remove, Move up and Move down per selected item (D.26)', () => {
    const onRemoveItem = jest.fn()
    const onMoveItem = jest.fn()
    renderPanel({ draft: draftWithSelections(), onRemoveItem, onMoveItem })
    fireEvent.click(screen.getByRole('button', { name: 'Remove dimension Created at' }))
    expect(onRemoveItem).toHaveBeenCalledWith('dimension', 'dim-1')
    fireEvent.click(screen.getByRole('button', { name: 'Move down dimension Created at' }))
    expect(onMoveItem).toHaveBeenCalledWith('dimension', 'dim-1', 'down')
    fireEvent.click(screen.getByRole('button', { name: 'Move up dimension Stage' }))
    expect(onMoveItem).toHaveBeenCalledWith('dimension', 'dim-2', 'up')
    fireEvent.click(screen.getByRole('button', { name: 'Remove metric Value' }))
    expect(onRemoveItem).toHaveBeenCalledWith('metric', 'met-2')
  })

  it('renders a granularity select for date dimensions (AC 7)', () => {
    renderPanel({ draft: draftWithSelections() })
    const dimensions = screen.getByLabelText('Dimensions drop zone')
    const granularity = within(dimensions).getByLabelText('Granularity for Created at')
    expect(granularity).toHaveValue('MONTH')
    fireEvent.change(granularity, { target: { value: 'QUARTER' } })
    // handled by the builder reducer via onSetGranularity
  })

  it('renders an aggregation select per metric (AC 8)', () => {
    const onSetAggregation = jest.fn()
    renderPanel({ draft: draftWithSelections(), onSetAggregation })
    const metrics = screen.getByLabelText('Metrics drop zone')
    fireEvent.change(within(metrics).getByLabelText('Aggregation for Value'), {
      target: { value: 'AVERAGE' },
    })
    expect(onSetAggregation).toHaveBeenCalledWith('met-2', 'AVERAGE')
  })

  it('provides Add count of deals (entity count metric)', () => {
    const onAddCountMetric = jest.fn()
    renderPanel({ draft: draftWithSelections(), onAddCountMetric })
    fireEvent.click(screen.getByRole('button', { name: /Add count of deals/ }))
    expect(onAddCountMetric).toHaveBeenCalled()
  })

  describe('calculated fields (AC 13, E8)', () => {
    it('opens the editor, validates the expression inline and adds the field', () => {
      const onAddCalculatedField = jest.fn()
      renderPanel({ draft: draftWithSelections(), onAddCalculatedField })
      fireEvent.click(screen.getByRole('button', { name: /New calculated field/ }))
      fireEvent.change(screen.getByLabelText('Alias'), { target: { value: 'avg_deal_size' } })
      fireEvent.change(screen.getByLabelText('Expression'), {
        target: { value: 'revenue / deals' },
      })
      fireEvent.click(screen.getByRole('button', { name: /Add calculated field/ }))
      expect(onAddCalculatedField).toHaveBeenCalledWith(
        expect.objectContaining({
          alias: 'avg_deal_size',
          expression: 'revenue / deals',
        }),
      )
    })

    it('shows an inline error for unknown aliases and does not add', () => {
      const onAddCalculatedField = jest.fn()
      renderPanel({ draft: draftWithSelections(), onAddCalculatedField })
      fireEvent.click(screen.getByRole('button', { name: /New calculated field/ }))
      fireEvent.change(screen.getByLabelText('Alias'), { target: { value: 'bad' } })
      fireEvent.change(screen.getByLabelText('Expression'), {
        target: { value: 'revenue / nope' },
      })
      fireEvent.click(screen.getByRole('button', { name: /Add calculated field/ }))
      expect(screen.getByText(/Unknown alias: nope/)).toBeInTheDocument()
      expect(onAddCalculatedField).not.toHaveBeenCalled()
    })

    it('shows an inline error for duplicate aliases', () => {
      const onAddCalculatedField = jest.fn()
      renderPanel({ draft: draftWithSelections(), onAddCalculatedField })
      fireEvent.click(screen.getByRole('button', { name: /New calculated field/ }))
      fireEvent.change(screen.getByLabelText('Alias'), { target: { value: 'revenue' } })
      fireEvent.change(screen.getByLabelText('Expression'), {
        target: { value: 'deals * 2' },
      })
      fireEvent.click(screen.getByRole('button', { name: /Add calculated field/ }))
      expect(screen.getByText(/Duplicate calculated alias/)).toBeInTheDocument()
      expect(onAddCalculatedField).not.toHaveBeenCalled()
    })

    it('lists existing calculated fields with remove controls', () => {
      const draft = draftWithSelections()
      draft.calculatedFields = [
        {
          id: 'calc-1',
          alias: 'avg_deal_size',
          label: 'Avg deal size',
          expression: 'revenue / deals',
        },
      ]
      const onRemoveCalculatedField = jest.fn()
      renderPanel({ draft, onRemoveCalculatedField })
      expect(screen.getByText('avg_deal_size')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /Remove calculated field avg_deal_size/ }))
      expect(onRemoveCalculatedField).toHaveBeenCalledWith('calc-1')
    })
  })

  it('shows catalogue loading and error states', () => {
    renderPanel({ catalog: null, catalogLoading: true })
    expect(screen.getByText(/Loading fields/i)).toBeInTheDocument()
    renderPanel({ catalog: null, catalogError: 'Could not load field catalogue' })
    expect(screen.getByText(/Could not load field catalogue/)).toBeInTheDocument()
  })

  it('explains unavailable roles instead of fabricating null columns (AC 7)', () => {
    renderPanel({ draft: draftWithSelections() })
    // 'Deal ID' is METRIC-only — no Add as dimension button, and the palette
    // shows the role hint rather than an invented dimension column.
    const palette = screen.getByLabelText('Available fields')
    expect(
      within(palette).queryByRole('button', { name: 'Add Deal ID as dimension' }),
    ).not.toBeInTheDocument()
  })

  describe('sorting (AC 14)', () => {
    const sortProps = {
      onAddSort: jest.fn(),
      onRemoveSort: jest.fn(),
      onSetSortDirection: jest.fn(),
      onMoveSort: jest.fn(),
    }

    it('lists existing sort rules with direction, move and remove controls (non-drag)', () => {
      const draft = draftWithSelections()
      draft.sort = [
        { id: 'sort-1', targetId: 'met-2', direction: 'DESC' },
        { id: 'sort-2', targetId: 'dim-2', direction: 'ASC' },
      ]
      renderPanel({ draft, ...sortProps })
      expect(screen.getByText('Value (revenue)')).toBeInTheDocument()
      expect(screen.getByLabelText('Direction for Value (revenue)')).toHaveValue('DESC')
      expect(screen.getByLabelText('Direction for Stage')).toHaveValue('ASC')
      // Role labels under each rule — 'Dimension'/'Metric' are unique to the sort rows.
      expect(screen.getAllByText('Dimension')).toHaveLength(1)
      expect(screen.getAllByText('Metric')).toHaveLength(1)
      fireEvent.click(screen.getByRole('button', { name: 'Remove sort rule Value (revenue)' }))
      expect(sortProps.onRemoveSort).toHaveBeenCalledWith('sort-1')
      fireEvent.click(screen.getByRole('button', { name: 'Move up sort rule Stage' }))
      expect(sortProps.onMoveSort).toHaveBeenCalledWith('sort-2', 'up')
      fireEvent.click(screen.getByRole('button', { name: 'Move down sort rule Value (revenue)' }))
      expect(sortProps.onMoveSort).toHaveBeenCalledWith('sort-1', 'down')
    })

    it('adds a sort rule referencing a selected id via the inline editor', () => {
      const draft = draftWithSelections()
      renderPanel({ draft, ...sortProps })
      fireEvent.click(screen.getByRole('button', { name: /Add sort rule/ }))
      const sortBy = screen.getByLabelText('Sort by')
      expect(sortBy).toHaveValue('dim-1')
      fireEvent.change(sortBy, { target: { value: 'met-2' } })
      fireEvent.change(screen.getByLabelText('Sort direction'), { target: { value: 'DESC' } })
      fireEvent.click(screen.getByRole('button', { name: /Add sort rule/ }))
      expect(sortProps.onAddSort).toHaveBeenCalledWith(
        expect.objectContaining({ targetId: 'met-2', direction: 'DESC' }),
      )
    })

    it('changes the direction of an existing rule (ASC/DESC)', () => {
      const draft = draftWithSelections()
      draft.sort = [{ id: 'sort-1', targetId: 'met-2', direction: 'DESC' }]
      renderPanel({ draft, ...sortProps })
      fireEvent.change(screen.getByLabelText('Direction for Value (revenue)'), {
        target: { value: 'ASC' },
      })
      expect(sortProps.onSetSortDirection).toHaveBeenCalledWith('sort-1', 'ASC')
    })

    it('only offers selected dimension/metric/calculated ids as sort targets (A.9)', () => {
      const draft = draftWithSelections()
      draft.calculatedFields = [
        { id: 'calc-1', alias: 'avg_deal_size', label: null, expression: 'revenue / deals' },
      ]
      renderPanel({ draft, ...sortProps })
      fireEvent.click(screen.getByRole('button', { name: /Add sort rule/ }))
      const sortBy = screen.getByLabelText('Sort by')
      expect(
        within(sortBy)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual([
        'Dimension: Created at',
        'Dimension: Stage',
        'Metric: Deal ID (deals)',
        'Metric: Value (revenue)',
        'Calculated: avg_deal_size',
      ])
    })

    it('disables Add sort rule at MAX_SORTS', () => {
      const draft = draftWithSelections()
      draft.sort = [
        { id: 's1', targetId: 'met-1', direction: 'ASC' },
        { id: 's2', targetId: 'met-2', direction: 'ASC' },
        { id: 's3', targetId: 'dim-1', direction: 'ASC' },
      ]
      renderPanel({ draft, ...sortProps })
      expect(screen.getByRole('button', { name: /Add sort rule/ })).toBeDisabled()
    })

    it('disables Add sort rule when nothing is selected', () => {
      renderPanel({ ...sortProps })
      expect(screen.getByRole('button', { name: /Add sort rule/ })).toBeDisabled()
    })
  })
})
