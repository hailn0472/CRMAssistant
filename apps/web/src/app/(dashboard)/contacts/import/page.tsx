'use client'

import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'react-hot-toast'

import { ImportDropZone } from '@/components/contacts/ImportDropZone'
import { ImportPreview } from '@/components/contacts/ImportPreview'
import { ImportProgress } from '@/components/contacts/ImportProgress'
import { ImportResult } from '@/components/contacts/ImportResult'
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

const STEPS: Array<{ key: WizardStep; label: string }> = [
  { key: 'upload', label: 'Upload' },
  { key: 'preview', label: 'Preview' },
  { key: 'importing', label: 'Import' },
  { key: 'result', label: 'Result' },
]

const IMPORT_COLUMNS = [
  { name: 'email', required: true },
  { name: 'firstName', required: true },
  { name: 'lastName', required: true },
  { name: 'phone', required: false },
  { name: 'company', required: false },
  { name: 'jobTitle', required: false },
]

const UPLOAD_TIPS = [
  'First row must be a header row.',
  'Use UTF-8 encoding for accented names.',
  'Separate multiple tags with a semicolon.',
]

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

  const stepIndex = STEPS.findIndex((s) => s.key === step)

  return (
    <div className="mx-auto w-full max-w-[1100px] space-y-[18px]">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-[28px] font-bold tracking-tight text-slate-900">Import contacts</h1>
          <p className="max-w-[56ch] text-[13.5px] text-slate-500">
            Upload a CSV and map its columns. Nothing is saved until you confirm the preview.
          </p>
        </div>
        <Link
          href="/contacts"
          className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3.5 text-[13px] font-medium text-slate-600 transition-colors hover:bg-slate-50"
        >
          Back to contacts
        </Link>
      </div>

      {/* Step indicator */}
      <ol className="flex flex-wrap items-center rounded-xl border border-slate-200 bg-white px-[18px] py-3.5">
        {STEPS.map((s, index) => {
          const isDone = index < stepIndex
          const isCurrent = index === stepIndex
          return (
            <li key={s.key} className="flex items-center gap-2.5 pr-[18px]">
              <span
                aria-hidden
                className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold ${
                  isCurrent
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : isDone
                      ? 'border-slate-900 bg-white text-slate-900'
                      : 'border-slate-200 bg-slate-50 text-slate-400'
                }`}
              >
                {isDone ? '✓' : index + 1}
              </span>
              <span
                aria-current={isCurrent ? 'step' : undefined}
                className={`text-[13px] ${
                  isCurrent ? 'font-semibold text-slate-900' : 'font-medium text-slate-500'
                }`}
              >
                {s.label}
              </span>
              {index < STEPS.length - 1 ? (
                <span aria-hidden className="block h-px w-[26px] bg-slate-200" />
              ) : null}
            </li>
          )
        })}
      </ol>

      {step === 'upload' ? (
        <div className="grid items-start gap-4 lg:grid-cols-[1.55fr_1fr]">
          <ImportDropZone
            isLoading={isLoading}
            onDownloadTemplate={handleDownloadTemplate}
            onFileSelected={handleFileSelected}
          />

          <aside className="flex flex-col gap-4">
            <section className="rounded-2xl border border-slate-200 bg-white px-5 py-[18px]">
              <h2 className="mb-3 text-[13.5px] font-semibold text-slate-900">Required columns</h2>
              <div className="flex flex-col gap-2.5">
                {IMPORT_COLUMNS.map((column) => (
                  <div
                    key={column.name}
                    className="flex items-center justify-between gap-3 text-[12.5px]"
                  >
                    <span className="font-mono text-slate-900">{column.name}</span>
                    <span
                      className={`text-[11.5px] font-medium ${
                        column.required ? 'text-slate-900' : 'text-slate-400'
                      }`}
                    >
                      {column.required ? 'Required' : 'Optional'}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white px-5 py-[18px]">
              <h2 className="mb-2.5 text-[13.5px] font-semibold text-slate-900">
                Before you upload
              </h2>
              <div className="flex flex-col gap-2 text-[12.5px] text-slate-600">
                {UPLOAD_TIPS.map((tip) => (
                  <div key={tip} className="flex gap-2">
                    <span className="text-slate-300">&mdash;</span>
                    <span>{tip}</span>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      ) : null}

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
