'use client'

import { formatCurrency } from '@/components/deals/deal-display'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import type { ForecastBand } from '@/services/forecast.service'

interface ForecastBandsProps {
  commit: ForecastBand
  bestCase: ForecastBand
  pipeline: ForecastBand
  currency: string
}

const BAND_CONFIG = [
  {
    key: 'commit',
    label: 'Commit',
    description: 'Probability ≥ 75% — high-confidence deals',
    color: 'bg-green-50 border-green-200',
    textColor: 'text-green-800',
    band: null as ForecastBand | null,
  },
  {
    key: 'bestCase',
    label: 'Best Case',
    description: 'Probability ≥ 50% — likely to close',
    color: 'bg-blue-50 border-blue-200',
    textColor: 'text-blue-800',
    band: null as ForecastBand | null,
  },
  {
    key: 'pipeline',
    label: 'Pipeline',
    description: 'All deals in range',
    color: 'bg-slate-50 border-slate-200',
    textColor: 'text-slate-800',
    band: null as ForecastBand | null,
  },
]

export function ForecastBands({
  commit,
  bestCase,
  pipeline,
  currency,
}: ForecastBandsProps): React.JSX.Element {
  const bands = [
    { ...BAND_CONFIG[0], band: commit },
    { ...BAND_CONFIG[1], band: bestCase },
    { ...BAND_CONFIG[2], band: pipeline },
  ]

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {bands.map((config) => {
        const b = config.band!
        return (
          <Card key={config.key} className={`${config.color}`}>
            <CardHeader className="pb-2">
              <CardTitle className={`text-lg ${config.textColor}`}>{config.label}</CardTitle>
              <p className="text-xs text-slate-500">{config.description}</p>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div>
                  <span className="text-xs text-slate-500">Weighted Value</span>
                  <p className={`text-xl font-bold ${config.textColor}`}>
                    {formatCurrency(b.weightedValue, currency)}
                  </p>
                </div>
                <div className="flex gap-4 text-sm">
                  <div>
                    <span className="text-xs text-slate-500">Total Value</span>
                    <p className="font-medium">{formatCurrency(b.totalValue, currency)}</p>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500">Deals</span>
                    <p className="font-medium">{b.count}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
