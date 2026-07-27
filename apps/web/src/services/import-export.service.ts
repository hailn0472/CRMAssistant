import type {
  ExportFilters,
  ImportPreviewResponse,
  ImportStartedResponse,
  ImportStatusResponse,
  ImportStrategy,
} from '@/types/import-export.types'

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
    // An aborted request must surface as an AbortError so callers can tell a
    // cancellation apart from a genuine network failure.
    if (err instanceof DOMException && err.name === 'AbortError') throw err
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

/**
 * Starts a confirmed import. Returns as soon as the server has accepted the
 * file; progress is then polled via `getImportStatus`.
 */
export async function startImport(
  file: File,
  strategy: ImportStrategy,
  signal?: AbortSignal,
): Promise<ImportStartedResponse> {
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

export async function getImportStatus(
  importId: string,
  signal?: AbortSignal,
): Promise<ImportStatusResponse> {
  const response = await fetchWithErrorHandling(
    `${CONTACTS_API}/import/${encodeURIComponent(importId)}/status`,
    { signal },
  )

  return response.json()
}

export function buildExportParams(filters?: ExportFilters): string {
  const params = new URLSearchParams()
  if (filters?.tags && filters.tags.length > 0) params.set('tags', filters.tags.join(','))
  if (filters?.company) params.set('company', filters.company)
  if (filters?.search) params.set('search', filters.search)
  if (filters?.jobTitle) params.set('jobTitle', filters.jobTitle)
  if (filters?.createdAtFrom) params.set('createdAtFrom', filters.createdAtFrom)
  if (filters?.createdAtTo) params.set('createdAtTo', filters.createdAtTo)
  return params.toString()
}

export async function exportContacts(filters?: ExportFilters, signal?: AbortSignal): Promise<Blob> {
  const queryString = buildExportParams(filters)
  const url = `${CONTACTS_API}/export${queryString ? `?${queryString}` : ''}`

  const response = await fetchWithErrorHandling(url, { signal })
  return response.blob()
}

export async function downloadTemplate(signal?: AbortSignal): Promise<string> {
  const response = await fetchWithErrorHandling(`${CONTACTS_API}/import/template`, { signal })
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
