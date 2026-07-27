'use client'

import { useCallback, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

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
    <div>
      <Card
        className={`border-2 border-dashed transition-colors ${
          isDragOver
            ? 'border-blue-500 bg-blue-50'
            : error
              ? 'border-red-300 bg-red-50'
              : selectedFile
                ? 'border-green-300 bg-green-50'
                : 'border-slate-300 bg-white'
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <CardContent className="flex flex-col items-center justify-center gap-4 py-12">
          {selectedFile ? (
            <>
              <div className="flex items-center gap-2 text-sm text-slate-700">
                <span className="font-medium">{selectedFile.name}</span>
                <span className="text-slate-400">({(selectedFile.size / 1024).toFixed(1)} KB)</span>
              </div>
              {isLoading ? (
                <p className="text-sm text-slate-500" role="status">
                  Analyzing file&hellip;
                </p>
              ) : (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleClear}>
                    Remove
                  </Button>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="text-slate-500">
                <svg
                  className="mx-auto h-12 w-12"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
              </div>
              <p className="text-sm text-slate-600">
                Drag and drop a CSV file here, or{' '}
                <button
                  className="font-medium text-blue-700 hover:text-blue-800 hover:underline"
                  onClick={handleBrowseClick}
                  type="button"
                >
                  browse files
                </button>
              </p>
              <p className="text-xs text-slate-400">Accepted formats: .csv, .tsv (max 10MB)</p>
              <input
                accept=".csv,.tsv"
                className="hidden"
                data-testid="file-input"
                onChange={handleInputChange}
                ref={inputRef}
                type="file"
              />
              <Button className="mt-2" size="sm" variant="outline" onClick={onDownloadTemplate}>
                Download template CSV
              </Button>
            </>
          )}
        </CardContent>
      </Card>
      {error && (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
