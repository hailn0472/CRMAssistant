'use client'

import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export type ImportResultProps = {
  imported: number
  skipped: number
  updated: number
  failed: number
  _totalRows: number
  duration: number
  onImportAnother: () => void
}

export function ImportResult({
  imported,
  skipped,
  updated,
  failed,
  duration,
  onImportAnother,
}: ImportResultProps): React.JSX.Element {
  const router = useRouter()

  const durationSeconds = (duration / 1000).toFixed(1)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Import Complete</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Duration */}
        <p className="text-sm text-slate-500">Completed in {durationSeconds} seconds</p>

        {/* Counts Grid */}
        <div className="grid grid-cols-4 gap-4 text-center">
          <div>
            <div className="text-2xl font-bold text-green-600">{imported}</div>
            <div className="text-xs text-slate-500">Imported</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-yellow-600">{skipped}</div>
            <div className="text-xs text-slate-500">Skipped</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-blue-600">{updated}</div>
            <div className="text-xs text-slate-500">Updated</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-red-600">{failed}</div>
            <div className="text-xs text-slate-500">Failed</div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end gap-3">
          <Button onClick={onImportAnother} variant="outline">
            Import Another File
          </Button>
          <Button
            className="bg-slate-950 text-white hover:bg-slate-800"
            onClick={() => router.push('/contacts')}
          >
            View Contacts
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
