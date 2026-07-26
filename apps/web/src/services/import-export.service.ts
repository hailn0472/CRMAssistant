import type { ImportPreviewResponse, ImportResultResponse } from '@/types/import-export.types'

// Calls Next.js API routes (/api/contacts/*) which proxy to NestJS with the
// httpOnly auth cookie attached automatically by the browser.
const CONTACTS_API = '/api/contacts'

class ImportExportError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'ImportExportError'
  }
}

async function fetchWithErrorHandling(
  url: string,
  options: RequestInit & { signal?: AbortSignal } = {},
): Promise<Response> {
  let response: Response
  try {
    // No auth headers — browser sends httpOnly cookie automatically
    response = await fetch(url, options)
  } catch (err) {
    if (err instanceof TypeError) {
      throw new ImportExportError(
        'Network error: Unable to connect to server. Please check your connection.',
      )
    }
    throw new ImportExportError(err instanceof Error ? err.message : 'Unknown network error')
  }

  if (!response.ok) {
    const errorMessage = await getErrorMessage(response)
    throw new ImportExportError(errorMessage, response.status)
  }

  return response
}

export async function uploadPreview(
  file: File,
  signal?: AbortSignal,
): Promise<ImportPreviewResponse> {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetchWithErrorHandling(`${CONTACTS_API}/import`, {
    method: 'POST',
    body: formData,
    signal,
  })

  return response.json()
}

export async function confirmImport(
  file: File,
  strategy: 'skip' | 'update' | 'create_new',
  signal?: AbortSignal,
): Promise<ImportResultResponse> {
  const formData = new FormData()
  formData.append('file', file)

  const url = `${CONTACTS_API}/import?confirm=true&strategy=${encodeURIComponent(strategy)}`
  const response = await fetchWithErrorHandling(url, {
    method: 'POST',
    body: formData,
    signal,
  })

  return response.json()
}

export async function exportContacts(filters?: {
  tags?: string
  company?: string
  search?: string
}): Promise<Blob> {
  const params = new URLSearchParams()
  if (filters?.tags) params.set('tags', filters.tags)
  if (filters?.company) params.set('company', filters.company)
  if (filters?.search) params.set('search', filters.search)

  const queryString = params.toString()
  const url = `${CONTACTS_API}/export${queryString ? `?${queryString}` : ''}`

  const response = await fetchWithErrorHandling(url)
  return response.blob()
}

export async function downloadTemplate(): Promise<string> {
  const response = await fetch(`${CONTACTS_API}/import/template`)
  if (!response.ok) {
    throw new ImportExportError(await getErrorMessage(response), response.status)
  }
  const data = await response.json()
  return data.template as string
}

async function getErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json()
    return body.message ?? `Request failed with status ${response.status}`
  } catch {
    return `Request failed with status ${response.status}`
  }
}

export { ImportExportError }
