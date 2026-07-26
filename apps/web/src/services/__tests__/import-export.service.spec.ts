import {
  exportContacts,
  downloadTemplate,
  uploadPreview,
  confirmImport,
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

describe('exportContacts', () => {
  it('returns blob on success', async () => {
    const testBlob = new Blob(['a,b\n1,2'], { type: 'text/csv' })
    mockFetch.mockResolvedValueOnce(makeResp({ ok: true, blob: () => Promise.resolve(testBlob) }))

    const result = await exportContacts()
    expect(result).toBe(testBlob)
  })

  it('passes filter params when provided', async () => {
    mockFetch.mockResolvedValueOnce(makeResp())

    await exportContacts({ tags: 'VIP', company: 'Acme' })
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('tags=VIP')
    expect(url).toContain('company=Acme')
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
  })
})

describe('confirmImport', () => {
  it('confirms import with skip strategy', async () => {
    mockFetch.mockResolvedValueOnce(
      makeResp({
        ok: true,
        json: () =>
          Promise.resolve({
            totalRows: 1,
            imported: 1,
            skipped: 0,
            updated: 0,
            failed: 0,
            errors: [],
            duration: 100,
          }),
      }),
    )

    const file = new File(['a\n1'], 'test.csv', { type: 'text/csv' })
    const result = await confirmImport(file, 'skip')
    expect(result.imported).toBe(1)
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('confirm=true')
    expect(url).toContain('strategy=skip')
  })

  it('confirms import with update strategy', async () => {
    mockFetch.mockResolvedValueOnce(
      makeResp({
        ok: true,
        json: () =>
          Promise.resolve({
            totalRows: 1,
            imported: 0,
            updated: 1,
            skipped: 0,
            failed: 0,
            errors: [],
            duration: 50,
          }),
      }),
    )

    const file = new File(['a\n1'], 'test.csv', { type: 'text/csv' })
    const result = await confirmImport(file, 'update')
    expect(result.updated).toBe(1)
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('strategy=update')
  })
})
