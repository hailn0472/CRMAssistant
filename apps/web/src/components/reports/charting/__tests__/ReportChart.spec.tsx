import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReportChart } from '../ReportChart'
import type { NormalizedReportChart } from '@/lib/report-chart'

// Mock recharts for JSDOM
jest.mock('recharts', () => {
  const React = require('react')
  const MockContainer = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(
      'div',
      { 'data-testid': 'responsive-container', style: { width: 800, height: 400 } },
      children,
    )
  const MockTooltip = ({
    content,
  }: {
    content?: React.ReactElement | React.ComponentType<Record<string, unknown>>
  }) => {
    const props = {
      active: true,
      payload: [
        {
          name: 'Lead',
          value: 100,
          payload: {
            label: 'Lead',
            value: 100,
            percentage: 40.0,
            stageName: 'Lead Stage',
            previousConversionRate: 80.0,
            overallConversionRate: 50.0,
            cell: { xLabel: 'North', yLabel: 'Q1', intensity: 42 },
          },
        },
      ],
    }
    if (!content) return React.createElement('div', { 'data-testid': 'default-tooltip' })
    if (typeof content === 'function') return React.createElement(content, props)
    if (React.isValidElement(content)) return React.cloneElement(content, props)
    return React.createElement('div')
  }
  return {
    ResponsiveContainer: MockContainer,
    LineChart: MockContainer,
    Line: () => React.createElement('div'),
    BarChart: MockContainer,
    Bar: () => React.createElement('div'),
    PieChart: MockContainer,
    Pie: () => React.createElement('div'),
    AreaChart: MockContainer,
    Area: () => React.createElement('div'),
    FunnelChart: MockContainer,
    Funnel: () => React.createElement('div'),
    ScatterChart: MockContainer,
    Scatter: () => React.createElement('div'),
    Cell: () => React.createElement('div'),
    LabelList: () => React.createElement('div'),
    XAxis: () => React.createElement('div'),
    YAxis: () => React.createElement('div'),
    CartesianGrid: () => React.createElement('div'),
    Tooltip: (props: Record<string, unknown>) => React.createElement(MockTooltip, props),
  }
})

describe('ReportChart renderer (Contract C, AC 3-17)', () => {
  const lineChart: NormalizedReportChart = {
    type: 'LINE',
    title: 'Revenue Trends',
    showLegend: true,
    showDataLabels: true,
    colors: ['BLUE', 'VIOLET'],
    legendPosition: 'BOTTOM',
    xAxisLabel: 'Month',
    yAxisLabel: 'Revenue',
    series: [
      { metricId: 'm1', label: 'Revenue' },
      { metricId: 'm2', label: 'Target' },
    ],
    points: [
      {
        key: '2026-01',
        label: 'Jan 2026',
        dimensionLabels: ['Jan 2026'],
        values: { m1: 1000, m2: 800 },
      },
      {
        key: '2026-02',
        label: 'Feb 2026',
        dimensionLabels: ['Feb 2026'],
        values: { m1: 1500, m2: 1200 },
      },
    ],
    totalPoints: 2,
    srTable: {
      headers: ['Dimension', 'Revenue', 'Target'],
      rows: [
        ['Jan 2026', '1000', '800'],
        ['Feb 2026', '1500', '1200'],
      ],
    },
  }

  it('renders line chart with title, interactive legend and sr-only table', () => {
    render(<ReportChart chart={lineChart} />)

    expect(screen.getByTestId('chart-title')).toHaveTextContent('Revenue Trends')
    expect(screen.getByRole('toolbar', { name: 'Toggle series visibility' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Toggle series Revenue' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  it('provides keyboard drill equivalent buttons when onDrillDown is supplied', () => {
    const onDrillDown = jest.fn()
    render(<ReportChart chart={lineChart} onDrillDown={onDrillDown} />)

    const drillBtn = screen.getByRole('button', { name: 'Jan 2026' })
    expect(drillBtn).toBeInTheDocument()

    fireEvent.click(drillBtn)
    expect(onDrillDown).toHaveBeenCalledWith({
      pointKey: '2026-01',
      metricId: 'm1',
      label: 'Jan 2026',
    })
  })

  it('toggles series visibility when legend buttons are clicked', () => {
    render(<ReportChart chart={lineChart} />)

    const toggleBtn = screen.getByRole('button', { name: 'Toggle series Revenue' })
    fireEvent.click(toggleBtn)
    expect(toggleBtn).toHaveAttribute('aria-pressed', 'false')
  })

  it('renders explicit intensity legend for HEATMAP (Contract C.13)', () => {
    const heatmapChart: NormalizedReportChart = {
      type: 'HEATMAP',
      title: 'Activity Density',
      showLegend: true,
      showDataLabels: false,
      colors: ['GREEN'],
      legendPosition: 'BOTTOM',
      xLabels: ['Alice', 'Bob'],
      yLabels: ['Call', 'Email'],
      metricId: 'm1',
      metricLabel: 'Count',
      minIntensity: 10,
      maxIntensity: 50,
      cells: [
        {
          key: 'c1',
          xLabel: 'Alice',
          yLabel: 'Call',
          intensity: 10,
          normalizedIntensity: 0,
          dimensionLabels: ['Alice', 'Call'],
          metricId: 'm1',
        },
      ],
      totalPoints: 1,
      srTable: {
        headers: ['Dimension 1', 'Dimension 2', 'Count'],
        rows: [['Alice', 'Call', '10']],
      },
    }

    render(<ReportChart chart={heatmapChart} />)

    const legend = screen.getByTestId('heatmap-intensity-legend')
    expect(legend).toBeInTheDocument()
    expect(legend).toHaveTextContent('10 (Min)')
    expect(legend).toHaveTextContent('50 (Max)')
  })

  it('renders chart-specific percentage in PIE/DONUT tooltip (Contract C.16)', () => {
    const pieChart: NormalizedReportChart = {
      type: 'PIE',
      isDonut: false,
      title: 'Deals Proportions',
      showLegend: true,
      showDataLabels: false,
      colors: ['BLUE'],
      legendPosition: 'BOTTOM',
      metricId: 'm1',
      metricLabel: 'Count',
      total: 250,
      slices: [
        {
          key: 's1',
          label: 'Lead',
          value: 100,
          percentage: 40.0,
          dimensionLabels: ['Lead'],
          metricId: 'm1',
        },
      ],
      totalPoints: 1,
      srTable: {
        headers: ['Category', 'Count', 'Percentage'],
        rows: [['Lead', '100', '40.0%']],
      },
    }

    render(<ReportChart chart={pieChart} />)
    const tooltip = screen.getByTestId('pie-tooltip')
    expect(tooltip).toBeInTheDocument()
    expect(tooltip).toHaveTextContent('Proportion:')
    expect(tooltip).toHaveTextContent('40.0%')
  })

  it('renders chart-specific conversion rates in FUNNEL tooltip (Contract C.16)', () => {
    const funnelChart: NormalizedReportChart = {
      type: 'FUNNEL',
      title: 'Deal Funnel',
      showLegend: true,
      showDataLabels: false,
      colors: ['BLUE'],
      legendPosition: 'BOTTOM',
      metricId: 'm1',
      metricLabel: 'Count',
      stages: [
        {
          key: 'st-1',
          stageName: 'Lead Stage',
          value: 100,
          previousConversionRate: 80.0,
          overallConversionRate: 50.0,
          dimensionLabels: ['Lead Stage'],
          metricId: 'm1',
        },
      ],
      totalPoints: 1,
      srTable: {
        headers: ['Stage', 'Count', 'vs Previous', 'vs Overall'],
        rows: [['Lead Stage', '100', '80.0%', '50.0%']],
      },
    }

    render(<ReportChart chart={funnelChart} />)
    const tooltip = screen.getByTestId('funnel-tooltip')
    expect(tooltip).toBeInTheDocument()
    expect(tooltip).toHaveTextContent('vs Previous Stage:')
    expect(tooltip).toHaveTextContent('80%')
    expect(tooltip).toHaveTextContent('vs Overall (First Stage):')
    expect(tooltip).toHaveTextContent('50%')
  })
})
