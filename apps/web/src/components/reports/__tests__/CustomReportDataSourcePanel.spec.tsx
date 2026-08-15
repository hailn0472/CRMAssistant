/**
 * Story 6.3 (AC 5, 7, E7, S6): CustomReportDataSourcePanel RTL.
 * Four entity choices, source-specific filter rows, active-filter summary and
 * the source-change confirmation flow (Contract D.25).
 */
import { fireEvent, render, screen, within } from '@testing-library/react'

import { CustomReportDataSourcePanel } from '../CustomReportDataSourcePanel'
import type {
  CustomReportCatalog,
  CustomReportDataSource,
  CustomReportDraft,
  CustomReportFilter,
} from '@/lib/custom-report-builder'
import { createEmptyDraft } from '@/lib/custom-report-builder'

const CATALOG: CustomReportCatalog = {
  dataSource: 'DEALS',
  fields: [
    {
      key: 'deal.stage',
      label: 'Stage',
      valueType: 'RELATION',
      roles: ['FILTER', 'DIMENSION'],
      aggregations: [],
      filterOperators: ['EQ', 'NOT_EQ', 'IN'],
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
      filterOperators: ['EQ', 'GT', 'GTE', 'LT', 'LTE', 'BETWEEN'],
      relationKind: null,
      isNumeric: true,
      isCurrency: true,
      isDate: false,
    },
    {
      key: 'deal.createdAt',
      label: 'Created at',
      valueType: 'DATETIME',
      roles: ['FILTER', 'DIMENSION'],
      aggregations: [],
      filterOperators: ['ON', 'BEFORE', 'AFTER', 'BETWEEN'],
      relationKind: null,
      isNumeric: false,
      isCurrency: false,
      isDate: true,
    },
    {
      key: 'deal.owner',
      label: 'Owner',
      valueType: 'RELATION',
      roles: ['FILTER', 'DIMENSION'],
      aggregations: [],
      filterOperators: ['EQ', 'NOT_EQ', 'IN'],
      relationKind: 'OWNER',
      isNumeric: false,
      isCurrency: false,
      isDate: false,
    },
  ],
}

function filter(
  id: string,
  fieldId: string,
  operator: string,
  stringValue: string,
): CustomReportFilter {
  return {
    id,
    fieldId,
    operator: operator as CustomReportFilter['operator'],
    stringValue,
    numberValue: null,
    booleanValue: null,
    dateValue: null,
    stringValues: null,
    numberValues: null,
    dateValues: null,
  }
}

function draftWithSelections(): CustomReportDraft {
  const draft = createEmptyDraft()
  draft.source = 'DEALS'
  draft.dimensions = [{ id: 'dim-1', fieldId: 'deal.stage', calculation: null, granularity: null }]
  draft.filters = [filter('f-1', 'deal.stage', 'EQ', 'stage-1')]
  return draft
}

const defaultProps: {
  draft: CustomReportDraft
  catalog: CustomReportCatalog | null
  catalogLoading: boolean
  catalogError: string | null
  canReadSource: (source: CustomReportDataSource) => boolean
  onSourceChange: jest.Mock
  onAddFilter: jest.Mock
  onUpdateFilter: jest.Mock
  onRemoveFilter: jest.Mock
} = {
  draft: createEmptyDraft(),
  catalog: CATALOG,
  catalogLoading: false,
  catalogError: null,
  canReadSource: (_source: CustomReportDataSource): boolean => true,
  onSourceChange: jest.fn(),
  onAddFilter: jest.fn(),
  onUpdateFilter: jest.fn(),
  onRemoveFilter: jest.fn(),
}

function renderPanel(props: Partial<typeof defaultProps> = {}): void {
  render(<CustomReportDataSourcePanel {...defaultProps} {...props} />)
}

describe('CustomReportDataSourcePanel (AC 5, E7)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders the four entity choices with read-gate sublabels', () => {
    renderPanel()
    expect(screen.getByRole('button', { name: /Contacts/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Deals/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Tasks/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Activities/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Deals/ }).textContent).toContain('DEAL:READ')
  })

  it('selecting a source reports the change', () => {
    const onSourceChange = jest.fn()
    renderPanel({ onSourceChange })
    fireEvent.click(screen.getByRole('button', { name: /Deals/ }))
    expect(onSourceChange).toHaveBeenCalledWith('DEALS')
  })

  it('selecting the already-selected source does nothing', () => {
    const draft = createEmptyDraft()
    draft.source = 'DEALS'
    const onSourceChange = jest.fn()
    renderPanel({ draft, onSourceChange })
    fireEvent.click(screen.getByRole('button', { name: /Deals/ }))
    expect(onSourceChange).not.toHaveBeenCalled()
  })

  it('source change after selections exist requires confirmation; cancel preserves the draft (E7)', () => {
    const onSourceChange = jest.fn()
    renderPanel({ draft: draftWithSelections(), onSourceChange })
    fireEvent.click(screen.getByRole('button', { name: /Contacts/ }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Keep current source|Cancel/i }))
    expect(onSourceChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('source change confirmation clears the draft via the builder callback (E7)', () => {
    const onSourceChange = jest.fn()
    renderPanel({ draft: draftWithSelections(), onSourceChange })
    fireEvent.click(screen.getByRole('button', { name: /Contacts/ }))
    fireEvent.click(screen.getByRole('button', { name: /Change source|Switch/i }))
    expect(onSourceChange).toHaveBeenCalledWith('CONTACTS')
  })

  it('renders existing filter rows and the active-filter summary chips', () => {
    renderPanel({ draft: draftWithSelections() })
    expect(screen.getAllByLabelText(/Field/).length).toBeGreaterThan(0)
    // Chip text includes the field label and the operator
    const summary = screen.getByLabelText('Active filters')
    expect(within(summary).getByText(/Stage/)).toBeInTheDocument()
  })

  it('removing a filter chip reports the removal', () => {
    const onRemoveFilter = jest.fn()
    renderPanel({ draft: draftWithSelections(), onRemoveFilter })
    const summary = screen.getByLabelText('Active filters')
    fireEvent.click(within(summary).getByRole('button', { name: /Remove filter/ }))
    expect(onRemoveFilter).toHaveBeenCalledWith('f-1')
  })

  it('adding a filter reports a new filter row with a default field', () => {
    const onAddFilter = jest.fn()
    renderPanel({ draft: draftWithSelections(), onAddFilter })
    fireEvent.click(screen.getByRole('button', { name: /Add filter/ }))
    expect(onAddFilter).toHaveBeenCalled()
    const added = onAddFilter.mock.calls[0][0] as CustomReportFilter
    expect(added.id).toBeTruthy()
    expect(added.fieldId).toBe('deal.stage')
    expect(added.operator).toBe('EQ')
  })

  it('changing a filter field resets its operator and value', () => {
    const onUpdateFilter = jest.fn()
    renderPanel({ draft: draftWithSelections(), onUpdateFilter })
    const fieldSelect = screen.getByLabelText(/Field/)
    fireEvent.change(fieldSelect, { target: { value: 'deal.value' } })
    expect(onUpdateFilter).toHaveBeenCalledWith(
      'f-1',
      expect.objectContaining({ fieldId: 'deal.value' }),
    )
  })

  it('renders a number input for numeric filter values and updates numberValue', () => {
    const draft = draftWithSelections()
    draft.filters = [filter('f-2', 'deal.value', 'GT', '')]
    const onUpdateFilter = jest.fn()
    renderPanel({ draft, onUpdateFilter })
    const valueInput = screen.getByLabelText(/^Value$/)
    expect(valueInput).toHaveAttribute('type', 'number')
    fireEvent.change(valueInput, { target: { value: '5000' } })
    expect(onUpdateFilter).toHaveBeenCalledWith(
      'f-2',
      expect.objectContaining({ numberValue: 5000 }),
    )
  })

  it('renders a date input for date filter values', () => {
    const draft = draftWithSelections()
    draft.filters = [filter('f-3', 'deal.createdAt', 'AFTER', '')]
    renderPanel({ draft })
    expect(screen.getByLabelText(/Value/)).toHaveAttribute('type', 'date')
  })

  it('renders two inputs for BETWEEN operators', () => {
    const draft = draftWithSelections()
    draft.filters = [filter('f-4', 'deal.value', 'BETWEEN', '')]
    renderPanel({ draft })
    expect(screen.getByLabelText(/Minimum/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Maximum/)).toBeInTheDocument()
  })

  it('disables entity cards whose read gate the user lacks (S6)', () => {
    renderPanel({ canReadSource: (source) => source === 'DEALS' })
    expect(screen.getByRole('button', { name: /Contacts/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Deals/ })).toBeEnabled()
  })

  it('shows catalogue loading and error states without crashing', () => {
    renderPanel({ catalog: null, catalogLoading: true })
    expect(screen.getByText(/Loading fields/i)).toBeInTheDocument()
    renderPanel({ catalog: null, catalogError: 'Missing required permission: DEAL:READ' })
    expect(screen.getByText(/Missing required permission/)).toBeInTheDocument()
  })
})
