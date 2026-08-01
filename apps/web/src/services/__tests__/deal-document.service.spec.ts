import {
  getDealDocuments,
  getDealDocumentDownloadUrl,
  deleteDealDocument,
  uploadDealDocument,
} from '../deal-document.service'

const mockFetch = jest.fn()

global.fetch = mockFetch

describe('deal-document.service', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('fetches the document list for a deal', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: {
          dealDocuments: [
            {
              id: 'doc-1',
              dealId: 'deal-1',
              fileName: 'contract.pdf',
              fileSize: 100,
              mimeType: 'application/pdf',
              uploadedBy: 'user-1',
              createdAt: '2026-07-31T00:00:00.000Z',
              uploader: { id: 'user-1', firstName: 'Ada', lastName: 'Lovelace', email: 'a@b.c' },
            },
          ],
        },
      }),
    })

    const result = await getDealDocuments('deal-1')

    expect(result).toHaveLength(1)
    expect(result[0]!.fileName).toBe('contract.pdf')
    const callBody = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string)
    expect(callBody.variables).toEqual({ dealId: 'deal-1' })
    expect(callBody.query).toContain('dealDocuments')
    expect(callBody.query).toContain('uploader { id firstName lastName email avatar }')
  })

  it('mints a download URL for a document', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: { dealDocumentDownloadUrl: 'https://signed.example/doc-1' },
      }),
    })

    const url = await getDealDocumentDownloadUrl('doc-1')

    expect(url).toBe('https://signed.example/doc-1')
    const callBody = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string)
    expect(callBody.variables).toEqual({ id: 'doc-1' })
  })

  it('deletes a document', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ data: { deleteDealDocument: true } }),
    })

    const result = await deleteDealDocument('doc-1')

    expect(result).toBe(true)
    const callBody = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string)
    expect(callBody.query).toContain('mutation DeleteDealDocument')
  })

  it('throws the upstream message when an upload fails', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 413,
      json: jest.fn().mockResolvedValue({ message: 'File too large' }),
    })

    const file = new File(['%PDF-1.7'], 'contract.pdf', { type: 'application/pdf' })
    await expect(uploadDealDocument('deal-1', file)).rejects.toThrow('File too large')
  })

  it('throws a fallback message when the error body is not JSON', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      json: jest.fn().mockRejectedValue(new Error('not json')),
    })

    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    await expect(uploadDealDocument('deal-1', file)).rejects.toThrow('Upload failed')
  })

  it('posts the file as multipart FormData to the proxy route', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        id: 'doc-1',
        dealId: 'deal-1',
        fileName: 'contract.pdf',
        fileSize: 10,
        mimeType: 'application/pdf',
        uploadedBy: 'user-1',
        createdAt: '2026-07-31T00:00:00.000Z',
        uploader: { id: 'user-1', firstName: 'Ada', lastName: 'Lovelace', email: 'a@b.c' },
      }),
    })

    const file = new File(['%PDF-1.7'], 'contract.pdf', { type: 'application/pdf' })
    const result = await uploadDealDocument('deal-1', file)

    expect(result.id).toBe('doc-1')
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/deals/deal-1/documents',
      expect.objectContaining({ method: 'POST' }),
    )
    const options = mockFetch.mock.calls[0]![1] as { body: FormData }
    expect(options.body.get('file')).toBe(file)
  })
})
