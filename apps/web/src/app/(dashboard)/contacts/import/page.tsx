'use client'

import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'react-hot-toast'

import { ImportDropZone } from '@/components/contacts/ImportDropZone'
import { ImportPreview } from '@/components/contacts/ImportPreview'
import { ImportProgress } from '@/components/contacts/ImportProgress'
import { ImportResult } from '@/components/contacts/ImportResult'
import { Button } from '@/components/ui/button'
import {
  downloadTemplate,
  getImportStatus,
  startImport,
  uploadPreview,
} from '@/services/import-export.service'
import type {
  ImportPreviewResponse,
  ImportProgress as ImportProgressState,
  ImportResultResponse,
  ImportStrategy,
} from '@/types/import-export.types'

type WizardStep = 'upload' | 'preview' | 'importing' | 'result'

const POLL_INTERVAL_MS = 1000

const EMPTY_PROGRESS: ImportProgressState = {
  batch: 0,
  totalBatches: 0,
  imported: 0,
  skipped: 0,
  updated: 0,
  failed: 0,
  totalRows: 0,
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export default function ImportPage(): React.JSX.Element {
  const queryClient = useQueryClient()

  const [step, setStep] = useState<WizardStep>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null)
  const [result, setResult] = useState<ImportResultResponse | null>(null)
  const [strategy, setStrategy] = useState<ImportStrategy>('skip')
  const [isLoading, setIsLoading] = useState(false)
  const [importId, setImportId] = useState<string | null>(null)
  const [progress, setProgress] = useState<ImportProgressState>(EMPTY_PROGRESS)

  const abortRef = useRef<AbortController | null>(null)

  // Cancels whatever request is in flight; used before starting a new one and
  // on unmount, so a stale response can never overwrite newer state.
  const abortInFlight = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  useEffect(() => abortInFlight, [abortInFlight])

  const handleFileSelected = useCallback(
    async (selectedFile: File) => {
      abortInFlight()
      const controller = new AbortController()
      abortRef.current = controller

      setFile(selectedFile)
      setIsLoading(true)

      try {
        const previewData = await uploadPreview(selectedFile, controller.signal)
        if (controller.signal.aborted) return
        setPreview(previewData)
        setStep('preview')
      } catch (error) {
        if (isAbort(error)) return
        toast.error(`Failed to preview file: ${errorMessage(error)}`)
        setFile(null)
      } finally {
        if (!controller.signal.aborted) setIsLoading(false)
      }
    },
    [abortInFlight],
  )

  const handleDownloadTemplate = useCallback(async () => {
    try {
      const template = await downloadTemplate()
      const blob = new Blob([template], { type: 'text/csv' })
      const url = window.URL.createObjectURL(blob)
      try {
        const a = document.createElement('a')
        a.href = url
        a.download = 'contact-import-template.csv'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
      } finally {
        window.URL.revokeObjectURL(url)
      }
    } catch (error) {
      toast.error(`Failed to download template: ${errorMessage(error)}`)
    }
  }, [])

  const handleConfirmImport = useCallback(async () => {
    if (!file) return

    abortInFlight()
    const controller = new AbortController()
    abortRef.current = controller

    setIsLoading(true)
    setStep('importing')
    setProgress({
      ...EMPTY_PROGRESS,
      totalRows: preview?.totalRows ?? 0,
      totalBatches: Math.ceil((preview?.totalRows ?? 0) / 100),
    })

    try {
      const started = await startImport(file, strategy, controller.signal)
      if (controller.signal.aborted) return
      setImportId(started.importId)
    } catch (error) {
      if (isAbort(error)) return
      toast.error(`Import failed: ${errorMessage(error)}`)
      setStep('preview')
      setIsLoading(false)
    }
  }, [abortInFlight, file, strategy, preview])

  // Polls the server while an import is running. The import itself continues
  // server-side regardless of this component, so leaving the page only stops the
  // updates, never the work.
  useEffect(() => {
    if (!importId || step !== 'importing') return

    let cancelled = false
    const controller = new AbortController()

    const poll = async (): Promise<void> => {
      try {
        const status = await getImportStatus(importId, controller.signal)
        if (cancelled) return

        setProgress(status.progress)

        if (status.status === 'running') return

        window.clearInterval(timer)
        setIsLoading(false)

        if (status.status === 'failed' && !status.result) {
          toast.error(`Import failed: ${status.error ?? 'Unknown error'}`)
          setStep('preview')
          return
        }

        if (status.result) {
          setResult(status.result)
          setStep('result')
          // Refresh the contact list so "View Contacts" does not render a stale
          // cache that predates the import.
          void queryClient.invalidateQueries({ queryKey: ['contacts'] })
        }
      } catch (error) {
        if (cancelled || isAbort(error)) return
        window.clearInterval(timer)
        setIsLoading(false)
        toast.error(`Lost track of the import: ${errorMessage(error)}`)
        setStep('preview')
      }
    }

    const timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS)
    void poll()

    return () => {
      cancelled = true
      controller.abort()
      window.clearInterval(timer)
    }
  }, [importId, step, queryClient])

  const handleReset = useCallback(() => {
    abortInFlight()
    setStep('upload')
    setFile(null)
    setPreview(null)
    setResult(null)
    setImportId(null)
    setStrategy('skip')
    setIsLoading(false)
    setProgress(EMPTY_PROGRESS)
  }, [abortInFlight])

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Import Contacts</h1>
          <p className="text-sm text-slate-500">
            Upload a CSV file to bulk-import contacts into your CRM
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/contacts">Back to Contacts</Link>
        </Button>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <span className={step === 'upload' ? 'font-medium text-slate-900' : ''}>Upload</span>
        <span>&rarr;</span>
        <span className={step === 'preview' ? 'font-medium text-slate-900' : ''}>Preview</span>
        <span>&rarr;</span>
        <span className={step === 'importing' ? 'font-medium text-slate-900' : ''}>Import</span>
        <span>&rarr;</span>
        <span className={step === 'result' ? 'font-medium text-slate-900' : ''}>Result</span>
      </div>

      {/* Step Content */}
      {step === 'upload' && (
        <ImportDropZone
          isLoading={isLoading}
          onDownloadTemplate={handleDownloadTemplate}
          onFileSelected={handleFileSelected}
        />
      )}

      {step === 'preview' && preview && (
        <ImportPreview
          duplicateRows={preview.duplicateRows}
          invalidRows={preview.invalidRows}
          isLoading={isLoading}
          newRows={preview.newRows}
          onCancel={handleReset}
          onConfirm={handleConfirmImport}
          onStrategyChange={setStrategy}
          previewRows={preview.previewRows}
          strategy={strategy}
          totalRows={preview.totalRows}
        />
      )}

      {step === 'importing' && (
        <ImportProgress
          currentBatch={progress.batch}
          failed={progress.failed}
          imported={progress.imported}
          skipped={progress.skipped}
          totalBatches={progress.totalBatches}
          totalRows={progress.totalRows}
          updated={progress.updated}
        />
      )}

      {step === 'result' && result && (
        <ImportResult
          duration={result.duration}
          errors={result.errors}
          failed={result.failed}
          imported={result.imported}
          onImportAnother={handleReset}
          skipped={result.skipped}
          totalRows={result.totalRows}
          updated={result.updated}
        />
      )}
    </div>
  )
}
