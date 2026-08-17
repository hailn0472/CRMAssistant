/**
 * Story 6.4 (Contract D.20-D.21) — accessible Viewport & Export Controls.
 *
 * Controls Zoom In/Out, Pan Previous/Next, and Reset with 44px min touch targets.
 * Includes a polite ARIA live-region announcing visible point range.
 * Also renders SVG and PNG download buttons for active charts.
 */
import React from 'react'
import {
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Download,
  Image as ImageIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface ReportChartControlsProps {
  startIndex: number
  endIndex: number
  totalPoints: number
  onZoomIn: () => void
  onZoomOut: () => void
  onPanPrevious: () => void
  onPanNext: () => void
  onReset: () => void
  onExportSvg?: () => void
  onExportPng?: () => void
  canZoomIn: boolean
  canZoomOut: boolean
  canPanPrev: boolean
  canPanNext: boolean
  canReset: boolean
  hideExport?: boolean
}

export function ReportChartControls({
  startIndex,
  endIndex,
  totalPoints,
  onZoomIn,
  onZoomOut,
  onPanPrevious,
  onPanNext,
  onReset,
  onExportSvg,
  onExportPng,
  canZoomIn,
  canZoomOut,
  canPanPrev,
  canPanNext,
  canReset,
  hideExport = false,
}: ReportChartControlsProps) {
  const displayStart = totalPoints === 0 ? 0 : startIndex + 1
  const displayEnd = Math.min(endIndex, totalPoints)
  const rangeAnnouncement = `Showing points ${displayStart}–${displayEnd} of ${totalPoints}`

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/50 px-3 py-2 text-xs"
      data-testid="report-chart-controls"
    >
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={onZoomIn}
          disabled={!canZoomIn}
          aria-label="Zoom in"
          className="h-11 min-w-[44px] px-2"
          title="Zoom in"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onZoomOut}
          disabled={!canZoomOut}
          aria-label="Zoom out"
          className="h-11 min-w-[44px] px-2"
          title="Zoom out"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <div className="mx-1 h-5 w-px bg-slate-200" />
        <Button
          variant="outline"
          size="sm"
          onClick={onPanPrevious}
          disabled={!canPanPrev}
          aria-label="Pan previous"
          className="h-11 min-w-[44px] px-2"
          title="Pan previous"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onPanNext}
          disabled={!canPanNext}
          aria-label="Pan next"
          className="h-11 min-w-[44px] px-2"
          title="Pan next"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onReset}
          disabled={!canReset}
          aria-label="Reset zoom and pan"
          className="h-11 min-w-[44px] px-2 text-slate-600 hover:text-slate-900"
          title="Reset zoom"
        >
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          Reset
        </Button>
      </div>

      <div
        className="text-slate-500 font-medium select-none"
        aria-live="polite"
        data-testid="viewport-range-summary"
      >
        {rangeAnnouncement}
      </div>

      {!hideExport && (
        <div className="flex items-center gap-1">
          {onExportSvg && (
            <Button
              variant="outline"
              size="sm"
              onClick={onExportSvg}
              aria-label="Export as SVG"
              className="h-11 min-w-[44px] px-2 text-slate-700"
              title="Download vector SVG"
            >
              <Download className="mr-1 h-3.5 w-3.5" />
              SVG
            </Button>
          )}
          {onExportPng && (
            <Button
              variant="outline"
              size="sm"
              onClick={onExportPng}
              aria-label="Export as PNG"
              className="h-11 min-w-[44px] px-2 text-slate-700"
              title="Download high-resolution PNG"
            >
              <ImageIcon className="mr-1 h-3.5 w-3.5" />
              PNG
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
