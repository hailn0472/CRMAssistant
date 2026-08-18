import {
  downloadFileFromUrl,
  sanitizeDownloadFilename,
  BrowserDownloadError,
} from '../browser-download'

describe('browser-download helper', () => {
  let originalFetch: typeof global.fetch
  let originalCreateObjectURL: typeof window.URL.createObjectURL
  let originalRevokeObjectURL: typeof window.URL.revokeObjectURL

  beforeEach(() => {
    jest.clearAllMocks()
    originalFetch = global.fetch
    originalCreateObjectURL = window.URL.createObjectURL
    originalRevokeObjectURL = window.URL.revokeObjectURL

    window.URL.createObjectURL = jest.fn(() => 'blob:https://crm.app/mock-blob-uuid')
    window.URL.revokeObjectURL = jest.fn()
  })

  afterEach(() => {
    global.fetch = originalFetch
    window.URL.createObjectURL = originalCreateObjectURL
    window.URL.revokeObjectURL = originalRevokeObjectURL
  })

  describe('sanitizeDownloadFilename', () => {
    it('returns fallback if filename is undefined, empty, or whitespace', () => {
      expect(sanitizeDownloadFilename(undefined, 'default.pdf')).toBe('default.pdf')
      expect(sanitizeDownloadFilename('', 'default.pdf')).toBe('default.pdf')
      expect(sanitizeDownloadFilename('   ', 'default.pdf')).toBe('default.pdf')
    })

    it('strips directory paths and control characters', () => {
      expect(sanitizeDownloadFilename('../../../etc/passwd.pdf')).toBe('etc_passwd.pdf')
      expect(sanitizeDownloadFilename('sales/\0report\n.csv')).toBe('sales_report.csv')
      expect(sanitizeDownloadFilename('..my_report.xlsx..')).toBe('my_report.xlsx')
    })

    it('preserves valid alphanumeric and symbol characters', () => {
      expect(sanitizeDownloadFilename('Sales_Report_2026-08-18.pdf')).toBe(
        'Sales_Report_2026-08-18.pdf',
      )
    })
  })

  describe('downloadFileFromUrl', () => {
    it('fetches cross-origin URL with credentials omit and cache no-store, creates blob object URL and clicks anchor', async () => {
      const mockBlob = new Blob(['sample-data'], { type: 'application/pdf' })
      const mockBlobFn = jest.fn().mockResolvedValue(mockBlob)

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        blob: mockBlobFn,
      } as unknown as Response)

      const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
      const appendChildSpy = jest.spyOn(document.body, 'appendChild')
      const removeChildSpy = jest.spyOn(document.body, 'removeChild')

      await downloadFileFromUrl({
        url: 'https://storage.supabase.co/signed/reports/123/file.pdf',
        filename: 'Quarterly_Report.pdf',
      })

      expect(global.fetch).toHaveBeenCalledWith(
        'https://storage.supabase.co/signed/reports/123/file.pdf',
        {
          method: 'GET',
          credentials: 'omit',
          cache: 'no-store',
        },
      )
      expect(mockBlobFn).toHaveBeenCalled()
      expect(window.URL.createObjectURL).toHaveBeenCalledWith(mockBlob)
      expect(appendChildSpy).toHaveBeenCalled()
      expect(clickSpy).toHaveBeenCalled()
      expect(removeChildSpy).toHaveBeenCalled()
      expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:https://crm.app/mock-blob-uuid')

      clickSpy.mockRestore()
      appendChildSpy.mockRestore()
      removeChildSpy.mockRestore()
    })

    it('revokes object URL even if clicking throws', async () => {
      const mockBlob = new Blob(['sample-data'], { type: 'application/pdf' })
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        blob: jest.fn().mockResolvedValue(mockBlob),
      } as unknown as Response)

      const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
        throw new Error('Click failed')
      })

      let thrownErr: unknown = null
      try {
        await downloadFileFromUrl({
          url: 'https://storage.supabase.co/signed/reports/123/file.pdf',
          filename: 'Quarterly_Report.pdf',
        })
      } catch (err) {
        thrownErr = err
      }

      expect(thrownErr).toBeInstanceOf(BrowserDownloadError)
      expect((thrownErr as BrowserDownloadError).code).toBe('CLICK_FAILED')
      expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:https://crm.app/mock-blob-uuid')

      clickSpy.mockRestore()
    })

    it('throws typed BrowserDownloadError when fetch fails with non-200 response without leaking signed URL in message', async () => {
      const signedUrl = 'https://storage.supabase.co/signed/reports/123/secret_token.pdf?token=xyz'
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 403,
      } as unknown as Response)

      let thrownErr: unknown = null
      try {
        await downloadFileFromUrl({
          url: signedUrl,
          filename: 'Quarterly_Report.pdf',
        })
      } catch (err) {
        thrownErr = err
      }

      expect(thrownErr).toBeInstanceOf(BrowserDownloadError)
      const downloadErr = thrownErr as BrowserDownloadError
      expect(downloadErr.code).toBe('HTTP_ERROR')
      expect(downloadErr.status).toBe(403)
      expect(downloadErr.message).toBe('Download request failed with status 403')
      expect(downloadErr.message).not.toContain('secret_token.pdf')
      expect(downloadErr.message).not.toContain('xyz')
      expect(window.URL.createObjectURL).not.toHaveBeenCalled()
    })

    it('throws typed BrowserDownloadError when network/CORS error occurs', async () => {
      const originalError = new TypeError('Failed to fetch')
      global.fetch = jest.fn().mockRejectedValue(originalError)

      let thrownErr: unknown = null
      try {
        await downloadFileFromUrl({
          url: 'https://storage.supabase.co/signed/reports/123/file.pdf',
        })
      } catch (err) {
        thrownErr = err
      }

      expect(thrownErr).toBeInstanceOf(BrowserDownloadError)
      const downloadErr = thrownErr as BrowserDownloadError
      expect(downloadErr.code).toBe('NETWORK_ERROR')
      expect(downloadErr.cause).toBe(originalError)
      expect(downloadErr.message).toBe('Download failed due to network or access restrictions')
      expect(downloadErr.message).not.toContain('https://')
    })

    it('throws typed BrowserDownloadError when reading blob fails', async () => {
      const blobError = new Error('Blob stream corrupt')
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        blob: jest.fn().mockRejectedValue(blobError),
      } as unknown as Response)

      let thrownErr: unknown = null
      try {
        await downloadFileFromUrl({
          url: 'https://storage.supabase.co/signed/reports/123/file.pdf',
        })
      } catch (err) {
        thrownErr = err
      }

      expect(thrownErr).toBeInstanceOf(BrowserDownloadError)
      const downloadErr = thrownErr as BrowserDownloadError
      expect(downloadErr.code).toBe('BLOB_ERROR')
      expect(downloadErr.cause).toBe(blobError)
    })
  })
})
