'use client'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { PreviewRow } from '@/types/import-export.types'

export type ImportPreviewProps = {
  totalRows: number
  newRows: number
  duplicateRows: number
  invalidRows: number
  previewRows: PreviewRow[]
  strategy: 'skip' | 'update' | 'create_new'
  onStrategyChange: (strategy: 'skip' | 'update' | 'create_new') => void
  onConfirm: () => void
  onCancel: () => void
  isLoading?: boolean
}

export function ImportPreview({
  totalRows,
  newRows,
  duplicateRows,
  invalidRows,
  previewRows,
  strategy,
  onStrategyChange,
  onConfirm,
  onCancel,
  isLoading = false,
}: ImportPreviewProps): React.JSX.Element {
  // The server returns rows in file order across all three categories, so the
  // first ten shown here include the duplicates and invalid rows the user needs
  // to see before choosing a strategy.
  const visibleRows = previewRows.slice(0, 10)

  const statusBadge = (status: PreviewRow['status'], reason?: string) => {
    switch (status) {
      case 'new':
        return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">New</Badge>
      case 'duplicate':
        return (
          <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">Duplicate</Badge>
        )
      case 'invalid':
        return (
          <Badge className="bg-red-100 text-red-800 hover:bg-red-100" title={reason}>
            Invalid
          </Badge>
        )
    }
  }

  return (
    <div className="space-y-6">
      {/* Summary Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Import Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold text-slate-900">{totalRows}</div>
              <div className="text-xs text-slate-500">Total Rows</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-green-600">{newRows}</div>
              <div className="text-xs text-slate-500">New</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-yellow-600">{duplicateRows}</div>
              <div className="text-xs text-slate-500">Duplicates</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-red-600">{invalidRows}</div>
              <div className="text-xs text-slate-500">Invalid</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Strategy Selector */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Duplicate Resolution Strategy</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm">
              <input
                checked={strategy === 'skip'}
                name="strategy"
                onChange={() => onStrategyChange('skip')}
                type="radio"
              />
              Skip — Import only new contacts
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                checked={strategy === 'update'}
                name="strategy"
                onChange={() => onStrategyChange('update')}
                type="radio"
              />
              Update — Overwrite existing contacts
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                checked={strategy === 'create_new'}
                name="strategy"
                onChange={() => onStrategyChange('create_new')}
                type="radio"
              />
              Create New — Treat all as new contacts
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Preview Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Preview ({visibleRows.length} of {totalRows} rows)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="py-3 pr-4 pl-4 font-medium">Line</th>
                  <th className="py-3 pr-4 font-medium">Email</th>
                  <th className="py-3 pr-4 font-medium">Name</th>
                  <th className="py-3 pr-4 font-medium">Status</th>
                  <th className="py-3 pr-4 font-medium">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleRows.map((row) => (
                  <tr className="hover:bg-slate-50" key={row.rowNumber}>
                    <td className="py-3 pr-4 pl-4 text-slate-400">{row.rowNumber}</td>
                    <td className="py-3 pr-4 text-slate-700">{row.email || '-'}</td>
                    <td className="py-3 pr-4 text-slate-700">
                      {row.firstName} {row.lastName}
                    </td>
                    <td className="py-3 pr-4">{statusBadge(row.status, row.reason)}</td>
                    <td className="py-3 pr-4 text-xs text-slate-500">
                      {row.status === 'duplicate' && row.existingContact ? (
                        <span>
                          Existing:{' '}
                          <span className="font-medium text-slate-700">
                            {row.existingContact.firstName} {row.existingContact.lastName}
                          </span>{' '}
                          &lt;{row.existingContact.email}&gt;
                        </span>
                      ) : row.status === 'invalid' && row.reason ? (
                        <span className="text-red-600">{row.reason}</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalRows > visibleRows.length && (
            <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
              Showing the first {visibleRows.length} rows in file order. All {totalRows} rows will
              be processed.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex justify-end gap-3">
        <Button disabled={isLoading} onClick={onCancel} variant="outline">
          Cancel
        </Button>
        <Button
          className="bg-slate-950 text-white hover:bg-slate-800"
          disabled={isLoading || newRows + duplicateRows === 0}
          onClick={onConfirm}
        >
          {isLoading ? 'Importing...' : 'Confirm & Import'}
        </Button>
      </div>
    </div>
  )
}
