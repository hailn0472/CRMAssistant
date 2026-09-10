import { render } from '@testing-library/react'

import {
  LoadingSkeleton,
  TableSkeleton,
  CardSkeleton,
  DashboardSkeleton,
  DetailSkeleton,
  FormSkeleton,
} from '../LoadingSkeleton'

describe('LoadingSkeleton', () => {
  it('TableSkeleton renders with aria-busy', () => {
    const { container } = render(<TableSkeleton rows={5} columns={4} />)

    expect(container.firstChild).toBeInTheDocument()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it('TableSkeleton renders configured rows and columns', () => {
    const { container } = render(<TableSkeleton rows={3} columns={3} />)

    // Header row (1) + data rows (3) = 4 rows
    const bodyRows = container.querySelectorAll('[class*="border-b"][class*="border-slate-100"]')
    expect(bodyRows.length).toBe(3)

    // Verify column count: each body row should contain 3 skeleton cells
    const firstBodyRow = bodyRows[0] as HTMLElement
    expect(firstBodyRow.children.length).toBe(3)
  })

  it('CardSkeleton renders without error', () => {
    const { container } = render(<CardSkeleton />)
    expect(container.firstChild).toBeInTheDocument()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it('DashboardSkeleton renders without error', () => {
    const { container } = render(<DashboardSkeleton />)
    expect(container.firstChild).toBeInTheDocument()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it('DetailSkeleton renders without error', () => {
    const { container } = render(<DetailSkeleton />)
    expect(container.firstChild).toBeInTheDocument()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it('FormSkeleton renders without error', () => {
    const { container } = render(<FormSkeleton />)
    expect(container.firstChild).toBeInTheDocument()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it('LoadingSkeleton renders a generic loading placeholder', () => {
    const { container } = render(<LoadingSkeleton />)
    expect(container.firstChild).toBeInTheDocument()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
  })
})
