'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { toast } from 'react-hot-toast'

export type ExportButtonProps = {
  filters?: {
    tags?: string[]
    company?: string
    search?: string
  }
}

export function ExportButton({ filters }: ExportButtonProps): React.JSX.Element {
  const [isExporting, setIsExporting] = useState(false)

  const handleExport = async (): Promise<void> => {
    setIsExporting(true)

    try {
      // Build filter params for the export service
      const params: Record<string, string> = {}
      if (filters?.tags && filters.tags.length > 0) {
        params.tags = filters.tags.join(',')
      }
      if (filters?.company) {
        params.company = filters.company
      }
      if (filters?.search) {
        params.search = filters.search
      }

      // Use dynamic import to avoid bundling issues
      const { exportContacts } = await import('@/services/import-export.service')
      const blob = await exportContacts(params)

      // Trigger browser download
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `contacts-${new Date().toISOString().split('T')[0]}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)

      toast.success('Contacts exported successfully')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Export failed'
      toast.error(message)
    } finally {
      setIsExporting(false)
    }
  }

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
