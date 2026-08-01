'use client'

import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { UploadCloud } from 'lucide-react'
import toast from 'react-hot-toast'

import { uploadDealDocument } from '@/services/deal-document.service'
import { validateDocumentFile } from '@/lib/deal-document-format'
import { Button } from '@/components/ui/button'

/**
 * Drag-and-drop upload zone with a mandatory non-drag alternative: a visible
 * "Choose file" button wired to a hidden `<input type="file">` (AC 40). The
 * zone disables while pending, success raises a concrete toast, and server
 * errors render in a role="alert" panel stating what failed and what to do
 * next — a 413 must say the file is too large, not "Something went wrong"
 * (AC 46). Client-side checks mirror the server allowlist but the server
 * remains the authority.
 */
export function DealDocumentUpload({ dealId }: { dealId: string }): React.JSX.Element {
  const queryClient = useQueryClient()
  const [isDragOver, setIsDragOver] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(
    async (file: File) => {
      const validationMessage = validateDocumentFile(file)
      if (validationMessage) {
        setError(validationMessage)
        return
      }

      setError(null)
      setPending(true)
      try {
        const document = await uploadDealDocument(dealId, file)
        // Refresh the documents list so the new row appears without a reload
        // (mirrors the delete mutation's invalidation in DealDocuments.tsx).
        queryClient.invalidateQueries({ queryKey: ['dealDocuments', dealId] })
        toast.success(`${document.fileName} attached`)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed'
        if (/too large|larger than|size/i.test(message)) {
          setError('This file is larger than the 10MB limit. Choose a smaller file and try again.')
        } else {
          setError(`Upload failed: ${message}. Check your connection and try again.`)
        }
      } finally {
        setPending(false)
        if (inputRef.current) {
          inputRef.current.value = ''
        }
      }
    },
    [dealId, queryClient],
  )

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      event.stopPropagation()
      setIsDragOver(false)

      // Ignore drops while an upload is in flight — a second file would race.
      if (pending) return

      const files = event.dataTransfer.files
      if (files.length === 0) return
      if (files.length > 1) {
        setError('Please drop a single file. Only one document can be attached at a time.')
        return
      }
      void handleFile(files[0]!)
    },
    [handleFile, pending],
  )

  const handleBrowseClick = useCallback(() => {
    inputRef.current?.click()
  }, [])

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files
      if (files && files.length > 0) {
        void handleFile(files[0]!)
      }
    },
    [handleFile],
  )

  return (
    <div className="space-y-2">
      <div
        role="button"
        tabIndex={0}
        aria-label="Attach a document"
        aria-disabled={pending}
        onClick={handleBrowseClick}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            handleBrowseClick()
          }
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`flex items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
          isDragOver
            ? 'border-indigo-400 bg-indigo-50'
            : 'border-slate-300 bg-white hover:border-indigo-300'
        } ${pending ? 'cursor-wait opacity-60' : 'cursor-pointer'}`}
      >
        <UploadCloud className="h-5 w-5 text-slate-400" aria-hidden="true" />
        <span className="text-slate-600">
          {pending ? (
            'Uploading...'
          ) : (
            <>
              Drag a document here or <span className="font-medium text-indigo-600">browse</span>
            </>
          )}
        </span>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,.xlsx,.png,.jpg,.jpeg"
        className="sr-only"
        onChange={handleInputChange}
        disabled={pending}
        tabIndex={-1}
      />

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleBrowseClick}
        disabled={pending}
        className="gap-1.5"
      >
        <UploadCloud className="h-3.5 w-3.5" />
        Choose file
      </Button>

      {error ? (
        <p role="alert" className="text-xs font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  )
}
