import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Badge } from '../badge'
import { Button } from '../button'
import { Select } from '../select'
import {
  CrmConfirmationDialogExample,
  CrmFormFieldExample,
  CrmQuickEditSheetExample,
  CrmTableExample,
} from '../crm-baseline-examples'

describe('Shared shadcn/ui baseline', () => {
  it('keeps Button variants available for CRM actions', () => {
    render(
      <div>
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Destructive</Button>
      </div>,
    )

    expect(screen.getByRole('button', { name: 'Primary' })).toHaveClass('bg-primary')
    expect(screen.getByRole('button', { name: 'Secondary' })).toHaveClass('bg-secondary')
    expect(screen.getByRole('button', { name: 'Outline' })).toHaveClass('border')
    expect(screen.getByRole('button', { name: 'Ghost' })).toHaveClass('hover:bg-accent')
    expect(screen.getByRole('button', { name: 'Destructive' })).toHaveClass('bg-destructive')
  })

  it('renders label-above-field form guidance with accessible fields', () => {
    render(<CrmFormFieldExample />)

    const referenceRegion = screen.getByRole('region', {
      name: 'Shared UI implementation reference',
    })
    const accountName = screen.getByLabelText('Account name')

    expect(referenceRegion).toHaveClass('rounded-xl')
    expect(referenceRegion).toHaveClass('border-slate-200')
    expect(referenceRegion).toHaveClass('bg-white')
    expect(referenceRegion).toHaveClass('shadow-sm')
    expect(accountName).toHaveClass('rounded-md')
    expect(accountName).toHaveClass('focus-visible:ring-2')
    expect(screen.getByLabelText('Summary')).toBeInTheDocument()
    expect(screen.getByLabelText('Priority')).toBeInTheDocument()
    expect(
      screen.getByText('Use the legal account name from the CRM workspace.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Account name is required for the sample flow.')).toBeInTheDocument()
  })

  it('renders stable Badge variants for CRM and AI states', () => {
    render(
      <div>
        <Badge variant="neutral">Neutral</Badge>
        <Badge variant="success">Success</Badge>
        <Badge variant="warning">Warning</Badge>
        <Badge variant="danger">Danger</Badge>
        <Badge variant="ai">AI generated</Badge>
      </div>,
    )

    expect(screen.getByText('Neutral')).toHaveClass('border-slate-200')
    expect(screen.getByText('Success')).toHaveClass('bg-emerald-50')
    expect(screen.getByText('Warning')).toHaveClass('bg-amber-50')
    expect(screen.getByText('Danger')).toHaveClass('bg-red-50')
    expect(screen.getByText('AI generated')).toHaveClass('bg-violet-50')
  })

  it('renders table header, row hover baseline, empty state and pagination placeholder', () => {
    render(<CrmTableExample />)

    expect(screen.getAllByRole('columnheader', { name: 'Record' })).toHaveLength(2)
    expect(screen.getByRole('cell', { name: 'Sample account' })).toBeInTheDocument()
    expect(screen.getByText('No records match this sample view.')).toBeInTheDocument()
    expect(screen.getByText('Pagination placeholder: 1-1 of 1')).toBeInTheDocument()

    const sampleRow = screen.getByRole('row', { name: /Sample account Active Human-owned/i })
    expect(sampleRow).toHaveClass('hover:bg-slate-50')
  })

  it('supports confirmation dialog behavior with accessible names', async () => {
    const user = userEvent.setup()
    render(<CrmConfirmationDialogExample />)

    await user.click(screen.getByRole('button', { name: 'Open confirmation sample' }))

    const dialog = screen.getByRole('alertdialog', { name: 'Archive sample record?' })
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveClass('rounded-xl')
    expect(dialog).toHaveClass('border-slate-200')
    expect(dialog).toHaveClass('bg-white')
    expect(dialog).toHaveClass('shadow-sm')
    expect(dialog).toHaveAccessibleDescription(
      'This reference flow confirms a reversible CRM action.',
    )
    expect(within(dialog).getByRole('button', { name: 'Keep record' })).toHaveFocus()

    await user.keyboard('{Tab}')
    expect(within(dialog).getByRole('button', { name: 'Archive sample' })).toHaveFocus()

    await user.keyboard('{Tab}')
    expect(within(dialog).getByRole('button', { name: 'Keep record' })).toHaveFocus()

    await user.keyboard('{Shift>}{Tab}{/Shift}')
    expect(within(dialog).getByRole('button', { name: 'Archive sample' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(
      screen.queryByRole('alertdialog', { name: 'Archive sample record?' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open confirmation sample' })).toHaveFocus()
  })

  it('supports quick create/edit sheet structure with accessible fields', async () => {
    const user = userEvent.setup()
    render(<CrmQuickEditSheetExample />)

    await user.click(screen.getByRole('button', { name: 'Open quick edit sample' }))

    const dialog = screen.getByRole('dialog', { name: 'Quick edit sample account' })
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveClass('border-slate-200')
    expect(dialog).toHaveClass('bg-white')
    expect(dialog).toHaveClass('shadow-sm')
    expect(dialog).toHaveAccessibleDescription('Sample/reference data only for implementers.')
    expect(within(dialog).getByLabelText('Display name')).toHaveFocus()
    expect(within(dialog).getByLabelText('Notes')).toBeInTheDocument()

    await user.keyboard('{Tab}')
    expect(within(dialog).getByLabelText('Notes')).toHaveFocus()

    await user.keyboard('{Tab}')
    expect(within(dialog).getByRole('button', { name: 'Close quick edit sample' })).toHaveFocus()

    await user.keyboard('{Tab}')
    expect(within(dialog).getByLabelText('Display name')).toHaveFocus()

    await user.keyboard('{Shift>}{Tab}{/Shift}')
    expect(within(dialog).getByRole('button', { name: 'Close quick edit sample' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(
      screen.queryByRole('dialog', { name: 'Quick edit sample account' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open quick edit sample' })).toHaveFocus()
  })

  it('keeps Select placeholder instructional instead of selectable', () => {
    render(
      <Select placeholder="Choose priority">
        <option value="normal">Normal</option>
      </Select>,
    )

    const placeholder = screen.getByText('Choose priority')
    expect(placeholder).toBeDisabled()
    expect(placeholder).toHaveAttribute('hidden')
  })
})
