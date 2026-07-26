'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export type ImportProgressProps = {
  currentBatch: number
  totalBatches: number
  imported: number
  skipped: number
  updated: number
  failed: number
  totalRows: number
}

export function ImportProgress({
  currentBatch,
  totalBatches,
  imported,
  skipped,
  updated,
  failed,
  totalRows,
}: ImportProgressProps): React.JSX.Element {
  const processed = imported + skipped + updated + failed
  const progressPct = totalRows > 0 ? Math.round((processed / totalRows) * 100) : 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Import in Progress</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Batch Counter */}
        <div className="text-sm text-slate-600">
          Batch {currentBatch}/{totalBatches} — {processed}/{totalRows} contacts
        </div>

        {/* Progress Bar */}
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-blue-600 transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* Live Counters */}
        <div className="grid grid-cols-4 gap-4 text-center text-sm">
          <div>
            <div className="text-lg font-bold text-green-600">{imported}</div>
            <div className="text-xs text-slate-500">Imported</div>
          </div>
          <div>
            <div className="text-lg font-bold text-yellow-600">{skipped}</div>
            <div className="text-xs text-slate-500">Skipped</div>
          </div>
          <div>
            <div className="text-lg font-bold text-blue-600">{updated}</div>
            <div className="text-xs text-slate-500">Updated</div>
          </div>
          <div>
            <div className="text-lg font-bold text-red-600">{failed}</div>
            <div className="text-xs text-slate-500">Failed</div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
