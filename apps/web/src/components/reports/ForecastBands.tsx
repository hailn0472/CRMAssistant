'use client'

import { formatCurrency } from '@/components/deals/deal-display'
import type { ForecastBand } from '@/services/forecast.service'

interface ForecastBandsProps {
  commit: ForecastBand
  bestCase: ForecastBand
  pipeline: ForecastBand
  currency: string
}

const BAND_CONFIG = [
  { key: 'commit', label: 'Commit', note: 'Probability ≥ 75% — high confidence', dot: '#22a06b' },
  {
    key: 'bestCase',
    label: 'Best case',
    note: 'Probability ≥ 50% — likely to close',
    dot: '#4f46e5',
  },
  { key: 'pipeline', label: 'Pipeline', note: 'All deals in range', dot: '#a0a0aa' },
] as const

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
    <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
      {bands.map((config) => (
        <div
          key={config.key}
          className="flex flex-col gap-3.5 rounded-[14px] border border-[#ececf0] bg-white px-5 py-[18px]"
        >
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span
                className="block h-[7px] w-[7px] shrink-0 rounded-full"
                style={{ background: config.dot }}
              />
              <h3 className="text-[14.5px] font-semibold text-[#1b1b1f]">{config.label}</h3>
            </div>
            <p className="text-[12.5px] text-[#8c8c96]">{config.note}</p>
          </div>

          <div className="flex flex-col gap-0.5">
            <span className="text-[11.5px] text-[#8c8c96]">Weighted value</span>
            <span className="text-[26px] font-semibold tracking-[-0.025em] text-[#1b1b1f]">
              {formatCurrency(config.band.weightedValue, currency)}
            </span>
          </div>

          <div className="flex gap-7 border-t border-[#f2f2f5] pt-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-[11.5px] text-[#8c8c96]">Total value</span>
              <span className="font-mono text-[13.5px] font-medium text-[#1b1b1f]">
                {formatCurrency(config.band.totalValue, currency)}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[11.5px] text-[#8c8c96]">Deals</span>
              <span className="font-mono text-[13.5px] font-medium text-[#1b1b1f]">
                {config.band.count}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
