'use client'

import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import { uploadDealDocument } from '@/services/deal-document.service'
import { validateDocumentFile } from '@/lib/deal-document-format'

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
        className={`flex flex-wrap items-center gap-3.5 rounded-[12px] border-[1.5px] border-dashed p-6 transition-colors ${
          isDragOver
            ? 'border-[#1b1b1f] bg-[#f7f7f8]'
            : 'border-[#d8d8e0] bg-[#fafafb] hover:border-[#1b1b1f] hover:bg-[#f7f7f8]'
        } ${pending ? 'cursor-wait opacity-60' : 'cursor-pointer'}`}
      >
        <span className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] border border-[#ececf0] bg-white">
          <span className="mt-[3px] block h-[12px] w-[12px] rotate-45 border-l-2 border-t-2 border-[#4b4b55]" />
        </span>
        <div className="flex min-w-0 flex-col gap-[3px]">
          <span className="text-[13.5px] font-semibold text-[#1b1b1f]">
            Drop contracts and proposals here
          </span>
          <span className="text-[12px] text-[#8c8c96]">
            or <span className="underline hover:text-[#1b1b1f]">browse files</span> · PDF, DOCX,
            XLSX up to 25 MB
          </span>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            handleBrowseClick()
          }}
          disabled={pending}
          className="ml-auto h-[34px] flex-none rounded-[9px] border border-[#1b1b1f] bg-[#1b1b1f] px-3.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-black disabled:opacity-50"
        >
          {pending ? 'Uploading...' : 'Choose file'}
        </button>
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

      {error ? (
        <p role="alert" className="mt-2 text-xs font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  )
}
