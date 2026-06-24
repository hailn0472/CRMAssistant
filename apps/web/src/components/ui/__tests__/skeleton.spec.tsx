import { render } from '@testing-library/react'

import {
  Skeleton,
  SkeletonText,
  SkeletonHeading,
  SkeletonCard,
  SkeletonTableRow,
} from '../skeleton'

describe('Skeleton', () => {
  it('renders base Skeleton with animate-pulse class', () => {
    const { container } = render(<Skeleton className="h-4 w-full" />)
    const element = container.firstChild as HTMLElement

    expect(element).toBeInTheDocument()
    expect(element.className).toMatch(/animate-pulse/)
    expect(element.className).toMatch(/bg-slate-200/)
  })

  it('SkeletonText renders with h-4 w-full', () => {
    const { container } = render(<SkeletonText />)
    const element = container.firstChild as HTMLElement

    expect(element.className).toMatch(/h-4/)
    expect(element.className).toMatch(/w-full/)
  })

  it('SkeletonHeading renders with h-6', () => {
    const { container } = render(<SkeletonHeading />)
    const element = container.firstChild as HTMLElement

    expect(element.className).toMatch(/h-6/)
  })

  it('SkeletonCard renders a card-shaped placeholder', () => {
    const { container } = render(<SkeletonCard />)

    expect(container.firstChild).toBeInTheDocument()
    expect((container.firstChild as HTMLElement).className).toMatch(/border/)
  })

  it('SkeletonTableRow renders correct number of columns', () => {
    const { container } = render(<SkeletonTableRow columns={4} />)
    expect(container.firstChild).toBeInTheDocument()
    // Each column is a flex-1 Skeleton; total child count should be 4 (columns)
    expect((container.firstChild as HTMLElement).children.length).toBe(4)
  })
})
