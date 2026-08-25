'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, FileSpreadsheet, FileText, Loader2, Table } from 'lucide-react'
import toast from 'react-hot-toast'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { downloadFileFromUrl } from '@/lib/browser-download'
import {
  exportReport,
  getReportExportDownloadUrl,
  reportExportKeys,
  type ReportDeliveryFormat,
  type ReportExport,
  type ReportFiltersInput,
} from '@/services/report-export.service'

export interface ExportReportMenuProps {
  reportId?: string | null
  reportName?: string
  filters?: ReportFiltersInput | null
  disabled?: boolean
  disabledReason?: string
  className?: string
  /** Story 6.8 (Contract E30): custom export function callback (e.g. exportActivityReport) */
  onExport?: (format: ReportDeliveryFormat) => Promise<ReportExport>
  /** Story 6.8 (Contract E30): supported formats (defaults to PDF, EXCEL, CSV) */
  supportedFormats?: ReportDeliveryFormat[]
}

export function ExportReportMenu({
  reportId,
  reportName = 'Report',
  filters,
  disabled = false,
  disabledReason,
  className,
  onExport,
  supportedFormats = ['PDF', 'EXCEL', 'CSV'],
}: ExportReportMenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [activeFormat, setActiveFormat] = useState<ReportDeliveryFormat | null>(null)
  const queryClient = useQueryClient()

  const isConfigured = Boolean(reportId || onExport)

  const handleExportSuccess = async (
    exportRecord: ReportExport,
    format: ReportDeliveryFormat,
  ): Promise<void> => {
    if (exportRecord.status === 'READY') {
      let download: { url: string; expiresAt: string } | null = null
      try {
        download = await getReportExportDownloadUrl(exportRecord.id)
      } catch (downloadErr) {
        toast.error('Export ready, but failed to fetch download URL. See export history.')
        return
      }

      if (download?.url) {
        const filename = exportRecord.filename || `${reportName}.${format.toLowerCase()}`
        try {
          await downloadFileFromUrl({
            url: download.url,
            filename,
            fallbackFilename: `${reportName}.${format.toLowerCase()}`,
          })
          toast.success(`Export ready: downloading ${format}...`)
        } catch (fileErr) {
          toast.error('Failed to download export file. See export history.')
        }
      }
      return
    }

    if (exportRecord.status === 'PENDING' || exportRecord.status === 'PROCESSING') {
      toast.success('Export queued in background. You will receive a notification when ready.', {
        duration: 5000,
      })
      return
    }

    if (exportRecord.status === 'FAILED') {
      const errorMsg = exportRecord.errorMessage || 'Export failed to generate.'
      toast.error(`Export failed: ${errorMsg}. Try narrowing date range or filters.`, {
        duration: 6000,
      })
    }
  }

  const exportMutation = useMutation({
    mutationFn: async (format: ReportDeliveryFormat) => {
      if (onExport) {
        return onExport(format)
      }
      if (!reportId) {
        throw new Error('Report must be saved before exporting.')
      }
      return exportReport(reportId, format, filters)
    },
    onSuccess: (exportRecord: ReportExport, format: ReportDeliveryFormat) => {
      queryClient.invalidateQueries({ queryKey: reportExportKeys.all })
      setOpen(false)
      setActiveFormat(null)

      // Do not make the mutation's UI state wait on a signed URL/blob download.
      // The export request has resolved, so the menu must leave its loading state.
      void handleExportSuccess(exportRecord, format)
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to request report export.')
    },
    onSettled: () => {
      setActiveFormat(null)
    },
  })

  const handleExport = (format: ReportDeliveryFormat) => {
    if (exportMutation.isPending || disabled || !isConfigured) return
    setActiveFormat(format)
    exportMutation.mutate(format)
  }

  const isExporting = exportMutation.isPending

  const triggerButton = (
    <Button
      type="button"
      variant="outline"
      disabled={disabled || !isConfigured || isExporting}
      aria-label="Export report"
      aria-haspopup="menu"
      aria-expanded={open}
      className={`min-h-[44px] min-w-[44px] gap-1.5 rounded-[9px] border-[#e6e6eb] bg-white text-[13px] font-medium text-[#4b4b55] hover:bg-[#f4f4f6] disabled:opacity-50 ${className || ''}`}
    >
      {isExporting ? (
        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin text-indigo-600" />
      ) : (
        <Download aria-hidden="true" className="h-4 w-4 text-[#77777f]" />
      )}
      <span>{isExporting ? `Exporting ${activeFormat}...` : 'Export'}</span>
    </Button>
  )

  if (disabled && disabledReason) {
    return (
      <div className="relative inline-block" title={disabledReason}>
        {triggerButton}
        <span className="sr-only">{disabledReason}</span>
      </div>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{triggerButton}</PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-56 rounded-xl border border-[#e6e6eb] bg-white p-1.5 shadow-lg"
      >
        <div role="menu" aria-label="Export formats" className="flex flex-col gap-0.5">
          {supportedFormats.includes('PDF') && (
            <button
              type="button"
              role="menuitem"
              disabled={isExporting}
              onClick={() => handleExport('PDF')}
              className="flex min-h-[44px] w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-[#1b1b1f] hover:bg-[#f4f4f6] focus:bg-[#f4f4f6] focus:outline-none disabled:opacity-50"
            >
              <FileText aria-hidden="true" className="h-4 w-4 text-red-600" />
              <div className="flex flex-col">
                <span>PDF Document</span>
                <span className="text-[11px] font-normal text-[#8c8c96]">
                  Formatted report with charts
                </span>
              </div>
            </button>
          )}

          {supportedFormats.includes('EXCEL') && (
            <button
              type="button"
              role="menuitem"
              disabled={isExporting}
              onClick={() => handleExport('EXCEL')}
              className="flex min-h-[44px] w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-[#1b1b1f] hover:bg-[#f4f4f6] focus:bg-[#f4f4f6] focus:outline-none disabled:opacity-50"
            >
              <FileSpreadsheet aria-hidden="true" className="h-4 w-4 text-emerald-600" />
              <div className="flex flex-col">
                <span>Excel (.xlsx)</span>
                <span className="text-[11px] font-normal text-[#8c8c96]">
                  Multi-sheet with formulas
                </span>
              </div>
            </button>
          )}

          {supportedFormats.includes('CSV') && (
            <button
              type="button"
              role="menuitem"
              disabled={isExporting}
              onClick={() => handleExport('CSV')}
              className="flex min-h-[44px] w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-[#1b1b1f] hover:bg-[#f4f4f6] focus:bg-[#f4f4f6] focus:outline-none disabled:opacity-50"
            >
              <Table aria-hidden="true" className="h-4 w-4 text-blue-600" />
              <div className="flex flex-col">
                <span>CSV Plain</span>
                <span className="text-[11px] font-normal text-[#8c8c96]">
                  Raw data with headers
                </span>
              </div>
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
