'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/** Rows shown before the error list collapses behind "Show all". */
const ERROR_PREVIEW_COUNT = 10

export type ImportResultProps = {
  imported: number
  skipped: number
  updated: number
  failed: number
  totalRows: number
  duration: number
  errors?: Array<{ row: number; reason: string }>
  onImportAnother: () => void
}

export function ImportResult({
  imported,
  skipped,
  updated,
  failed,
  totalRows,
  duration,
  errors = [],
  onImportAnother,
}: ImportResultProps): React.JSX.Element {
  const router = useRouter()
  const [showAllErrors, setShowAllErrors] = useState(false)

  const durationSeconds = (duration / 1000).toFixed(1)
  const visibleErrors = showAllErrors ? errors : errors.slice(0, ERROR_PREVIEW_COUNT)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Import Complete</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Duration */}
        <p className="text-sm text-slate-500">
          Processed {totalRows} rows in {durationSeconds} seconds
        </p>

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

        {/* Failed rows — the whole point of reporting a failure count */}
        {errors.length > 0 && (
          <div className="rounded-md border border-red-200 bg-red-50 p-4">
            <h3 className="mb-2 text-sm font-medium text-red-800">
              {errors.length} row{errors.length === 1 ? '' : 's'} could not be imported
            </h3>
            <ul className="space-y-1 text-xs text-red-700">
              {visibleErrors.map((error, index) => (
                <li key={`${error.row}-${index}`}>
                  {error.row > 0 ? `Line ${error.row}: ` : ''}
                  {error.reason}
                </li>
              ))}
            </ul>
            {errors.length > visibleErrors.length && (
              <Button
                className="mt-2 h-auto p-0 text-xs text-red-800"
                onClick={() => setShowAllErrors(true)}
                variant="link"
              >
                Show all {errors.length} errors
              </Button>
            )}
          </div>
        )}

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
