import { render, screen } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable'

import { DashboardGrid } from '../DashboardGrid'
import type { WidgetData } from '@/services/dashboard.service'

describe('DashboardGrid', () => {
  const widgets: WidgetData[] = [
    {
      id: 'w-1',
      type: 'METRIC_CARD',
      title: 'Pipeline Value',
      config: {
        source: 'PIPELINE_VALUE',
        dateRangeDays: 30,
        stageId: null,
        ownerId: null,
        limit: 5,
      },
      position: 0,
      size: '1x1',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'w-2',
      type: 'BAR_CHART',
      title: 'Pipeline by Stage',
      config: {
        source: 'PIPELINE_BY_STAGE',
        dateRangeDays: 30,
        stageId: null,
        ownerId: null,
        limit: 5,
      },
      position: 1,
      size: '2x2',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'w-3',
      type: 'TABLE',
      title: 'At-Risk Deals',
      config: {
        source: 'AT_RISK_DEALS',
        dateRangeDays: 30,
        stageId: null,
        ownerId: null,
        limit: 5,
      },
      position: 2,
      size: '3x2',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ]

  function renderGrid(): void {
    render(
      <DashboardGrid widgets={widgets}>
        {(widget) => <div data-testid={`widget-${widget.id}`}>{widget.title}</div>}
      </DashboardGrid>,
    )
  }

  it('renders the grid section with accessible label', () => {
    renderGrid()
    const section = screen.getByRole('region', { name: 'Dashboard widgets' })
    expect(section).toBeDefined()
  })

  it('renders grid with responsive column classes', () => {
    renderGrid()
    const section = screen.getByRole('region', { name: 'Dashboard widgets' })
    expect(section.className).toContain('grid')
    expect(section.className).toContain('grid-cols-1')
    expect(section.className).toContain('sm:grid-cols-2')
    expect(section.className).toContain('xl:grid-cols-4')
  })

  it('renders all widget children', () => {
    renderGrid()
    expect(screen.getByTestId('widget-w-1')).toBeDefined()
    expect(screen.getByTestId('widget-w-2')).toBeDefined()
    expect(screen.getByTestId('widget-w-3')).toBeDefined()
  })

  it('renders widget titles', () => {
    renderGrid()
    expect(screen.getByText('Pipeline Value')).toBeDefined()
    expect(screen.getByText('Pipeline by Stage')).toBeDefined()
    expect(screen.getByText('At-Risk Deals')).toBeDefined()
  })

  it('clamps widget columns on mobile and tablet while retaining desktop spans', () => {
    renderGrid()

    const mediumCell = screen.getByTestId('widget-w-2').parentElement
    const largeCell = screen.getByTestId('widget-w-3').parentElement

    expect(mediumCell).toHaveClass('col-span-1', 'sm:col-span-2', 'xl:col-span-2', 'min-w-0')
    expect(largeCell).toHaveClass('col-span-1', 'sm:col-span-2', 'xl:col-span-3', 'min-w-0')
    expect(mediumCell).not.toHaveClass('col-span-2')
    expect(largeCell).not.toHaveClass('col-span-3')
  })

  it('renders empty grid when no widgets', () => {
    render(
      <DashboardGrid widgets={[]}>
        {(widget) => <div key={widget.id}>{widget.title}</div>}
      </DashboardGrid>,
    )
    const section = screen.getByRole('region', { name: 'Dashboard widgets' })
    expect(section).toBeDefined()
    expect(section.children.length).toBe(0)
  })

  it('registers sortable nodes and passes drag handles when editing (AC 67)', () => {
    render(
      <DndContext onDragStart={jest.fn()} onDragEnd={jest.fn()}>
        <SortableContext items={['w-1', 'w-2', 'w-3']} strategy={rectSortingStrategy}>
          <DashboardGrid widgets={widgets} isEditing>
            {(widget, _span, handle) => (
              <div data-testid={`widget-${widget.id}`}>{handle ? 'draggable' : 'static'}</div>
            )}
          </DashboardGrid>
        </SortableContext>
      </DndContext>,
    )
    expect(screen.getByTestId('widget-w-1').textContent).toBe('draggable')
    expect(screen.getByTestId('widget-w-2').textContent).toBe('draggable')
    expect(screen.getByTestId('widget-w-3').textContent).toBe('draggable')
  })

  it('does not pass drag handles when not editing', () => {
    render(
      <DashboardGrid widgets={widgets}>
        {(widget, _span, handle) => (
          <div data-testid={`widget-${widget.id}`}>{handle ? 'draggable' : 'static'}</div>
        )}
      </DashboardGrid>,
    )
    expect(screen.getByTestId('widget-w-1').textContent).toBe('static')
  })
})
