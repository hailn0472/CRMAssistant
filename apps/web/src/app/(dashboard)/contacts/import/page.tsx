'use client'

import Link from 'next/link'
import { useCallback, useRef, useState } from 'react'

import { ImportDropZone } from '@/components/contacts/ImportDropZone'
import { ImportPreview } from '@/components/contacts/ImportPreview'
import { ImportProgress } from '@/components/contacts/ImportProgress'
import { ImportResult } from '@/components/contacts/ImportResult'
import { Button } from '@/components/ui/button'
import { uploadPreview, confirmImport, downloadTemplate } from '@/services/import-export.service'
import type { ImportPreviewResponse, ImportResultResponse } from '@/types/import-export.types'

type WizardStep = 'upload' | 'preview' | 'importing' | 'result'

export default function ImportPage(): React.JSX.Element {
  const [step, setStep] = useState<WizardStep>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null)
  const [result, setResult] = useState<ImportResultResponse | null>(null)
  const [strategy, setStrategy] = useState<'skip' | 'update' | 'create_new'>('skip')
  const [isLoading, setIsLoading] = useState(false)
  const [progress, setProgress] = useState({
    batch: 0,
    totalBatches: 0,
    imported: 0,
    skipped: 0,
    updated: 0,
    failed: 0,
  })
  const abortRef = useRef<AbortController | null>(null)

  const handleFileSelected = useCallback(async (selectedFile: File) => {
    setFile(selectedFile)
    setIsLoading(true)

    try {
      const abortController = new AbortController()
      abortRef.current = abortController

      const previewData = await uploadPreview(selectedFile, abortController.signal)
      setPreview(previewData)
      setStep('preview')
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        alert('Failed to preview file: ' + error.message)
      }
    } finally {
      setIsLoading(false)
    }
  }, [])

  const handleDownloadTemplate = useCallback(async () => {
    try {
      const template = await downloadTemplate()
      const blob = new Blob([template], { type: 'text/csv' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'contact-import-template.csv'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
    } catch (error) {
      alert(
        'Failed to download template: ' +
          (error instanceof Error ? error.message : 'Unknown error'),
      )
    }
  }, [])

  const handleConfirmImport = useCallback(async () => {
    if (!file) return

    setIsLoading(true)
    setStep('importing')

    // Simulate progress updates
    const totalBatches = Math.ceil(preview?.totalRows ?? 0 / 100)
    setProgress({ batch: 1, totalBatches, imported: 0, skipped: 0, updated: 0, failed: 0 })

    try {
      const abortController = new AbortController()
      abortRef.current = abortController

      const importResult = await confirmImport(file, strategy, abortController.signal)

      setResult(importResult)
      setStep('result')
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        alert('Import failed: ' + error.message)
        setStep('preview')
      }
    } finally {
      setIsLoading(false)
    }
  }, [file, strategy, preview])

  const handleReset = useCallback(() => {
    setStep('upload')
    setFile(null)
    setPreview(null)
    setResult(null)
    setStrategy('skip')
    setProgress({ batch: 0, totalBatches: 0, imported: 0, skipped: 0, updated: 0, failed: 0 })
  }, [])

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
          totalRows={preview?.totalRows ?? 0}
          updated={progress.updated}
        />
      )}

      {step === 'result' && result && (
        <ImportResult
          _totalRows={result.totalRows}
          duration={result.duration}
          failed={result.failed}
          imported={result.imported}
          onImportAnother={handleReset}
          skipped={result.skipped}
          updated={result.updated}
        />
      )}
    </div>
  )
}
