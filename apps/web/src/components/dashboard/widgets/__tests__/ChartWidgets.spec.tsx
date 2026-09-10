import React from 'react'
import { render, screen } from '@testing-library/react'

import { BarChartWidget } from '../BarChartWidget'
import { FunnelWidget } from '../FunnelWidget'
import { LineChartWidget } from '../LineChartWidget'
import { PieChartWidget } from '../PieChartWidget'
import type { WidgetResultData } from '@/services/dashboard.service'

const baseData: WidgetResultData = {
  widgetId: 'widget-1',
  source: 'LEAD_STATUS',
  type: 'BAR_CHART',
  generatedAt: '2026-01-01T00:00:00Z',
  permissionLimited: false,
  currency: null,
  metric: null,
  series: [],
  rows: [],
  total: null,
}

function dataWithPoints(
  points: WidgetResultData['series'][number]['points'],
  seriesKey = 'status',
): WidgetResultData {
  return {
    ...baseData,
    series: [{ key: seriesKey, label: 'Status', color: '#4f46e5', points }],
  }
}

describe('dashboard chart widgets', () => {
  it('renders bar-chart labels, values, and proportional widths across series', () => {
    const data: WidgetResultData = {
      ...baseData,
      series: [
        {
          key: 'pipeline',
          label: 'Pipeline',
          color: '#4f46e5',
          points: [{ key: 'qualified', label: 'Qualified', value: 1200, secondaryValue: null }],
        },
        {
          key: 'closed',
          label: 'Closed',
          color: '#22a06b',
          points: [{ key: 'won', label: 'Won', value: 600, secondaryValue: null }],
        },
      ],
    }

    const { container } = render(<BarChartWidget data={data} />)

    expect(screen.getByRole('img', { name: 'Bar chart' })).toBeInTheDocument()
    expect(screen.getByText('Qualified')).toBeInTheDocument()
    expect(screen.getByText('Won')).toBeInTheDocument()
    expect(screen.getByText('1,200')).toBeInTheDocument()
    expect(screen.getByText('600')).toBeInTheDocument()
    expect(container.querySelectorAll('[style*="width: 100%"]')).toHaveLength(1)
    expect(container.querySelector('[style*="width: 50%"]')).toBeInTheDocument()
  })

  it('shows the empty-state message for a bar chart without points', () => {
    render(<BarChartWidget data={baseData} />)

    expect(screen.getByText('No data available')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Bar chart' })).not.toBeInTheDocument()
  })

  it('renders funnel stages with formatted values and a minimum bar width', () => {
    const { container } = render(
      <FunnelWidget
        data={dataWithPoints([
          { key: 'new', label: 'New', value: 100, secondaryValue: null },
          { key: 'qualified', label: 'Qualified', value: 5, secondaryValue: null },
        ])}
      />,
    )

    expect(screen.getByRole('img', { name: 'Lead funnel' })).toBeInTheDocument()
    expect(screen.getByText('Contacts by qualification status')).toBeInTheDocument()
    expect(screen.getByText('New')).toBeInTheDocument()
    expect(screen.getByText('Qualified')).toBeInTheDocument()
    expect(screen.getByText('100')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(container.querySelector('[style*="width: 100%"]')).toBeInTheDocument()
    expect(container.querySelector('[style*="width: 18%"]')).toBeInTheDocument()
  })

  it('shows the empty-state message for an empty funnel', () => {
    render(<FunnelWidget data={baseData} />)

    expect(screen.getByText('No data available')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Lead funnel' })).not.toBeInTheDocument()
  })

  it('distinguishes a populated line source from an empty line source', () => {
    render(
      <LineChartWidget
        data={dataWithPoints([{ key: 'one', label: 'One', value: 1, secondaryValue: null }])}
      />,
    )
    expect(screen.getByText('This dashboard source does not use a line chart.')).toBeInTheDocument()

    render(<LineChartWidget data={baseData} />)
    expect(screen.getByText('No data available')).toBeInTheDocument()
  })

  it('renders pie values, percentages, and palette classes', () => {
    render(
      <PieChartWidget
        data={dataWithPoints([
          { key: 'new', label: 'New', value: 3, secondaryValue: null },
          { key: 'qualified', label: 'Qualified', value: 2, secondaryValue: null },
        ])}
      />,
    )

    expect(screen.getByRole('img', { name: 'Lead distribution' })).toBeInTheDocument()
    expect(screen.getByText('New')).toBeInTheDocument()
    expect(screen.getByText('Qualified')).toBeInTheDocument()
    expect(screen.getByText('3 (60%)')).toBeInTheDocument()
    expect(screen.getByText('2 (40%)')).toBeInTheDocument()
    expect(screen.getByText('New').previousElementSibling).toHaveClass('bg-indigo-500')
    expect(screen.getByText('Qualified').previousElementSibling).toHaveClass('bg-emerald-500')
  })

  it('renders zero percentages when pie points total zero', () => {
    render(
      <PieChartWidget
        data={dataWithPoints([
          { key: 'empty-a', label: 'Empty A', value: 0, secondaryValue: null },
          { key: 'empty-b', label: 'Empty B', value: 0, secondaryValue: null },
        ])}
      />,
    )

    expect(screen.getAllByText('0 (0%)')).toHaveLength(2)
  })

  it('shows the empty-state message for an empty pie', () => {
    render(<PieChartWidget data={baseData} />)

    expect(screen.getByText('No data available')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Lead distribution' })).not.toBeInTheDocument()
  })
})
