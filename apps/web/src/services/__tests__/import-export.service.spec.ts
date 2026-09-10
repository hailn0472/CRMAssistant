import {
  buildExportParams,
  exportContacts,
  downloadTemplate,
  getImportStatus,
  startImport,
  uploadPreview,
} from '../import-export.service'

const mockFetch = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
global.fetch = mockFetch

beforeEach(() => {
  jest.resetAllMocks()
})

function makeResp(overrides?: Record<string, unknown>): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve({}),
    blob: () => Promise.resolve(new Blob()),
    text: () => Promise.resolve(''),
    headers: new Headers(),
    redirected: false,
    type: 'basic' as const,
    url: '',
    clone: function () {
      return makeResp()
    },
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    formData: () => Promise.resolve(new FormData()),
    ...overrides,
  } as unknown as Response
}

function requestedUrl(call = 0): string {
  return mockFetch.mock.calls[call]![0] as string
}

describe('buildExportParams', () => {
  it('forwards every active filter, not just tags and company', async () => {
    const params = new URLSearchParams(
      buildExportParams({
        tags: ['VIP', 'Enterprise'],
        company: 'Acme',
        search: 'ada',
        jobTitle: 'CTO',
        createdAtFrom: '2026-01-01',
        createdAtTo: '2026-01-31',
      }),
    )

    expect(params.get('tags')).toBe('VIP,Enterprise')
    expect(params.get('company')).toBe('Acme')
    expect(params.get('search')).toBe('ada')
    expect(params.get('jobTitle')).toBe('CTO')
    expect(params.get('createdAtFrom')).toBe('2026-01-01')
    expect(params.get('createdAtTo')).toBe('2026-01-31')
  })

  it('omits empty filters', () => {
    expect(buildExportParams({ tags: [], company: '' })).toBe('')
    expect(buildExportParams()).toBe('')
  })
})

describe('exportContacts', () => {
  it('returns blob on success', async () => {
    const testBlob = new Blob(['a,b\n1,2'], { type: 'text/csv' })
    mockFetch.mockResolvedValueOnce(makeResp({ ok: true, blob: () => Promise.resolve(testBlob) }))

    const result = await exportContacts()
    expect(result).toBe(testBlob)
  })

  it('passes filter params when provided', async () => {
    mockFetch.mockResolvedValueOnce(makeResp())

    await exportContacts({ tags: ['VIP'], company: 'Acme', jobTitle: 'CTO' })

    expect(requestedUrl()).toContain('tags=VIP')
    expect(requestedUrl()).toContain('company=Acme')
    expect(requestedUrl()).toContain('jobTitle=CTO')
  })

  it('throws on server error', async () => {
    mockFetch.mockResolvedValueOnce(
      makeResp({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ message: 'Server error' }),
      }),
    )

    await expect(exportContacts()).rejects.toThrow('Server error')
  })

  it('throws with fallback on non-JSON error', async () => {
    mockFetch.mockResolvedValueOnce(
      makeResp({
        ok: false,
        status: 502,
        json: () => Promise.reject(new Error('parse fail')),
      }),
    )

    await expect(exportContacts()).rejects.toThrow('status 502')
  })

  it('reports a network failure with a friendly message', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    await expect(exportContacts()).rejects.toThrow('Network error')
  })

  it('propagates an abort so callers can tell it apart from a failure', async () => {
    mockFetch.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'))

    await expect(exportContacts()).rejects.toThrow(
      expect.objectContaining({ name: 'AbortError' }) as unknown as Error,
    )
  })
})

describe('downloadTemplate', () => {
  it('returns template string on success', async () => {
    mockFetch.mockResolvedValueOnce(
      makeResp({
        ok: true,
        json: () => Promise.resolve({ template: 'email,name\n' }),
      }),
    )

    const result = await downloadTemplate()
    expect(result).toBe('email,name\n')
  })

  it('throws on failure', async () => {
    mockFetch.mockResolvedValueOnce(
      makeResp({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ message: 'Fail' }),
      }),
    )

    await expect(downloadTemplate()).rejects.toThrow('Fail')
  })

  it('reports a network failure through the shared error wrapper', async () => {
    // downloadTemplate used to call bare fetch, surfacing a raw TypeError.
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    await expect(downloadTemplate()).rejects.toThrow('Network error')
  })
})

describe('uploadPreview', () => {
  it('returns preview response', async () => {
    mockFetch.mockResolvedValueOnce(
      makeResp({
        ok: true,
        json: () =>
          Promise.resolve({
            preview: true,
            totalRows: 2,
            newRows: 1,
            duplicateRows: 1,
            invalidRows: 0,
            previewRows: [],
          }),
      }),
    )

    const file = new File(['a\n1'], 'test.csv', { type: 'text/csv' })
    const result = await uploadPreview(file)

    expect(result.preview).toBe(true)
    expect(result.totalRows).toBe(2)
    expect(requestedUrl()).not.toContain('confirm=true')
  })
})

describe('startImport', () => {
  it.each(['skip', 'update', 'create_new'] as const)(
    'starts an import with the %s strategy and returns the import id',
    async (strategy) => {
      mockFetch.mockResolvedValueOnce(
        makeResp({
          ok: true,
          json: () => Promise.resolve({ importId: 'import-1', totalRows: 3 }),
        }),
      )

      const file = new File(['a\n1'], 'test.csv', { type: 'text/csv' })
      const result = await startImport(file, strategy)

      expect(result).toEqual({ importId: 'import-1', totalRows: 3 })
      expect(requestedUrl()).toContain('confirm=true')
      expect(requestedUrl()).toContain(`strategy=${strategy}`)
    },
  )

  it('sends the file as multipart form data', async () => {
    mockFetch.mockResolvedValueOnce(
      makeResp({ ok: true, json: () => Promise.resolve({ importId: 'x', totalRows: 1 }) }),
    )

    const file = new File(['a\n1'], 'test.csv', { type: 'text/csv' })
    await startImport(file, 'skip')

    const init = mockFetch.mock.calls[0]![1]!
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
  })

  it('throws with the server message when the upload is rejected', async () => {
    mockFetch.mockResolvedValueOnce(
      makeResp({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ message: 'missing required column "email"' }),
      }),
    )

    const file = new File(['a\n1'], 'test.csv', { type: 'text/csv' })
    await expect(startImport(file, 'skip')).rejects.toThrow('missing required column "email"')
  })
})

describe('getImportStatus', () => {
  it('fetches the status for an import id', async () => {
    mockFetch.mockResolvedValueOnce(
      makeResp({
        ok: true,
        json: () =>
          Promise.resolve({
            importId: 'import-1',
            status: 'running',
            progress: {
              batch: 1,
              totalBatches: 3,
              imported: 100,
              skipped: 0,
              updated: 0,
              failed: 0,
              totalRows: 250,
            },
          }),
      }),
    )

    const status = await getImportStatus('import-1')

    expect(requestedUrl()).toContain('/api/contacts/import/import-1/status')
    expect(status.status).toBe('running')
    expect(status.progress.imported).toBe(100)
  })

  it('encodes the import id', async () => {
    mockFetch.mockResolvedValueOnce(makeResp({ ok: true, json: () => Promise.resolve({}) }))

    await getImportStatus('a b/c')

    expect(requestedUrl()).toContain('a%20b%2Fc')
  })
})
