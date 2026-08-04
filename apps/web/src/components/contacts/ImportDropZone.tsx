'use client'

import { useCallback, useRef, useState } from 'react'
import { Upload } from 'lucide-react'

export type ImportDropZoneProps = {
  onFileSelected: (file: File) => void
  onDownloadTemplate: () => void
  /** True while the selected file is being analyzed by the server. */
  isLoading?: boolean
}

export function ImportDropZone({
  onFileSelected,
  onDownloadTemplate,
  isLoading = false,
}: ImportDropZoneProps): React.JSX.Element {
  const [isDragOver, setIsDragOver] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const validateFile = useCallback((file: File): boolean => {
    const allowedTypes = ['.csv', '.tsv']
    const dotIndex = file.name.lastIndexOf('.')
    const ext = dotIndex > 0 ? file.name.slice(dotIndex).toLowerCase() : ''
    if (!allowedTypes.includes(ext)) {
      setError(
        ext
          ? `Invalid file type "${ext}". Only CSV and TSV files are accepted.`
          : 'This file has no extension. Only CSV and TSV files are accepted.',
      )
      return false
    }

    if (file.size > 10 * 1024 * 1024) {
      setError('File is too large. Maximum size is 10MB.')
      return false
    }

    setError(null)
    return true
  }, [])

  const handleFile = useCallback(
    (file: File) => {
      if (validateFile(file)) {
        setSelectedFile(file)
        onFileSelected(file)
      }
    },
    [validateFile, onFileSelected],
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragOver(false)

      // Ignore drops while a file is already being analyzed, otherwise the
      // second upload races the first and the preview may describe a different
      // file than the one the user goes on to confirm.
      if (isLoading) return

      const files = e.dataTransfer.files
      if (files.length === 0) return
      if (files.length > 1) {
        setError('Please drop a single file. Only the first file would be imported.')
        return
      }
      handleFile(files[0]!)
    },
    [handleFile, isLoading],
  )

  const handleBrowseClick = useCallback(() => {
    inputRef.current?.click()
  }, [])

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (files && files.length > 0) {
        handleFile(files[0]!)
      }
    },
    [handleFile],
  )

  const handleClear = useCallback(() => {
    setSelectedFile(null)
    setError(null)
  }, [])

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div
        className={`flex flex-col items-center gap-3.5 rounded-xl border-[1.5px] border-dashed px-6 py-[38px] text-center transition-colors ${
          isDragOver
            ? 'border-slate-900 bg-slate-50'
            : error
              ? 'border-red-300 bg-red-50/60'
              : selectedFile
                ? 'border-emerald-300 bg-emerald-50/50'
                : 'border-slate-300 bg-slate-50/80 hover:border-slate-900 hover:bg-slate-50'
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {selectedFile ? (
          <>
            <div className="flex items-center gap-2 text-[13.5px] text-slate-700">
              <span className="font-medium">{selectedFile.name}</span>
              <span className="text-slate-400">({(selectedFile.size / 1024).toFixed(1)} KB)</span>
            </div>
            {isLoading ? (
              <p className="text-[12.5px] text-slate-500" role="status">
                Analyzing file&hellip;
              </p>
            ) : (
              <button
                type="button"
                onClick={handleClear}
                className="inline-flex h-[34px] items-center rounded-lg border border-slate-200 bg-white px-3.5 text-[12.5px] font-medium text-slate-600 transition-colors hover:bg-slate-100"
              >
                Remove
              </button>
            )}
          </>
        ) : (
          <>
            <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white">
              <Upload className="h-[18px] w-[18px] text-slate-600" />
            </span>
            <div className="flex flex-col gap-1.5">
              <div className="text-[14.5px] font-semibold text-slate-900">Drop your CSV here</div>
              <div className="text-[12.5px] text-slate-500">
                Drag and drop a CSV file here, or{' '}
                <button
                  className="font-medium text-indigo-600 hover:underline"
                  onClick={handleBrowseClick}
                  type="button"
                >
                  browse files
                </button>{' '}
                &middot; .csv, .tsv up to 10 MB
              </div>
            </div>
            <input
              accept=".csv,.tsv"
              className="hidden"
              data-testid="file-input"
              onChange={handleInputChange}
              ref={inputRef}
              type="file"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleBrowseClick}
                className="inline-flex h-[34px] items-center rounded-lg border border-slate-900 bg-slate-900 px-3.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-black"
              >
                Choose file
              </button>
              <button
                type="button"
                onClick={onDownloadTemplate}
                className="inline-flex h-[34px] items-center rounded-lg border border-slate-200 bg-white px-3.5 text-[12.5px] font-medium text-slate-600 transition-colors hover:bg-slate-100"
              >
                Download template CSV
              </button>
            </div>
          </>
        )}
      </div>

      {error && (
        <p className="mt-3 text-[12.5px] text-red-600" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
