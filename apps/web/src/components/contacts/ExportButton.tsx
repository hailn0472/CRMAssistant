'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'react-hot-toast'

import { Button } from '@/components/ui/button'
import type { ExportFilters } from '@/types/import-export.types'

export type ExportButtonProps = {
  filters?: ExportFilters
}

export function ExportButton({ filters }: ExportButtonProps): React.JSX.Element {
  const [isExporting, setIsExporting] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // Abort an in-flight export if the user navigates away mid-download.
  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  const handleExport = useCallback(async (): Promise<void> => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setIsExporting(true)

    let url: string | null = null
    try {
      const { exportContacts } = await import('@/services/import-export.service')
      const blob = await exportContacts(filters, controller.signal)
      if (controller.signal.aborted) return

      // Trigger browser download
      url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `contacts-${new Date().toISOString().split('T')[0]}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)

      toast.success('Contacts exported successfully')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      toast.error(error instanceof Error ? error.message : 'Export failed')
    } finally {
      if (url) window.URL.revokeObjectURL(url)
      if (!controller.signal.aborted) setIsExporting(false)
    }
  }, [filters])

  return (
    <Button
      className="bg-slate-950 text-white hover:bg-slate-800"
      disabled={isExporting}
      onClick={handleExport}
      type="button"
    >
      {isExporting ? 'Exporting...' : 'Export CSV'}
    </Button>
  )
}
