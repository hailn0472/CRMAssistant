'use client'

import { useRef, useState } from 'react'

import { Button } from '@/components/ui/button'

const MAX_FILE_SIZE = 2 * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/png']

type AvatarUploadProps = {
  currentUrl?: string | null
  firstName?: string
  lastName?: string
  onUpload: (file: File) => Promise<string>
}

export function AvatarUpload({
  currentUrl,
  firstName = '',
  lastName = '',
  onUpload,
}: AvatarUploadProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentUrl ?? null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleClick(): void {
    inputRef.current?.click()
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    if (!file) return

    setError(null)

    if (!ALLOWED_TYPES.includes(file.type)) {
      setError('Only JPG and PNG images are allowed')
      return
    }

    if (file.size > MAX_FILE_SIZE) {
      setError('Image must be less than 2MB')
      return
    }

    try {
      setUploading(true)
      const url = await onUpload(file)
      setPreviewUrl(url)
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (inputRef.current) {
        inputRef.current.value = ''
      }
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png"
        className="hidden"
        onChange={handleFileChange}
      />
      {previewUrl ? (
        <img
          src={previewUrl}
          alt="Avatar preview"
          className="h-24 w-24 rounded-full border border-slate-200 object-cover"
        />
      ) : (
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-slate-100 text-2xl font-semibold text-slate-400">
          {firstName.charAt(0)}
          {lastName.charAt(0)}
        </div>
      )}

      <div className="flex flex-col items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={handleClick}
        >
          {uploading ? 'Uploading...' : previewUrl ? 'Change photo' : 'Upload photo'}
        </Button>
        <span className="text-xs text-slate-500">JPG or PNG, max 2MB</span>
        {error ? (
          <span className="text-xs font-medium text-red-700" role="alert">
            {error}
          </span>
        ) : null}
      </div>
    </div>
  )
}
