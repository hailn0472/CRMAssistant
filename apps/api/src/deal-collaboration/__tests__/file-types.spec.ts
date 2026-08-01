import {
  ALLOWED_DOCUMENT_TYPES,
  MAX_DOCUMENT_BYTES,
  sanitizeFileName,
  detectDocumentType,
} from '../file-types'

describe('file-types', () => {
  describe('ALLOWED_DOCUMENT_TYPES', () => {
    it('covers exactly PDF, DOCX, XLSX, PNG, JPG and JPEG', () => {
      const extensions = ALLOWED_DOCUMENT_TYPES.map((t) => t.extension).sort()
      expect(extensions).toEqual(['docx', 'jpeg', 'jpg', 'pdf', 'png', 'xlsx'])
    })

    it('caps uploads at 10MB', () => {
      expect(MAX_DOCUMENT_BYTES).toBe(10 * 1024 * 1024)
    })

    it('DOCX and XLSX share the ZIP magic bytes', () => {
      const docx = ALLOWED_DOCUMENT_TYPES.find((t) => t.extension === 'docx')
      const xlsx = ALLOWED_DOCUMENT_TYPES.find((t) => t.extension === 'xlsx')
      expect(docx!.magic.equals(xlsx!.magic)).toBe(true)
    })
  })

  describe('sanitizeFileName', () => {
    it('strips path separators and directory traversal', () => {
      expect(sanitizeFileName('../../etc/passwd')).toBe('etcpasswd')
    })

    it('replaces unicode and unsafe characters with dashes', () => {
      expect(sanitizeFileName('tài liệu.pdf')).toBe('t-i-li-u.pdf')
    })

    it('collapses runs of dashes and trims leading/trailing dashes', () => {
      expect(sanitizeFileName('a--b---c.pdf')).toBe('a-b-c.pdf')
    })

    it('keeps safe characters and truncates to 100 chars', () => {
      const result = sanitizeFileName('x'.repeat(150) + '.pdf')
      expect(result.length).toBe(100)
      expect(result).toMatch(/^[A-Za-z0-9._-]+$/)
    })
  })

  describe('detectDocumentType', () => {
    it('accepts a PDF with real magic bytes', () => {
      expect(
        detectDocumentType('contract.pdf', 'application/pdf', Buffer.from('%PDF-1.7\n...')),
      ).toEqual({ extension: 'pdf', mimeType: 'application/pdf' })
    })

    it('accepts DOCX with ZIP magic bytes', () => {
      expect(
        detectDocumentType(
          'report.docx',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]),
        ),
      ).toEqual({
        extension: 'docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
    })

    it('accepts XLSX with ZIP magic bytes', () => {
      expect(
        detectDocumentType(
          'data.xlsx',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14]),
        ),
      ).toEqual({
        extension: 'xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
    })

    it('accepts PNG and JPEG', () => {
      expect(
        detectDocumentType('pic.png', 'image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d])),
      ).toEqual({ extension: 'png', mimeType: 'image/png' })
      expect(
        detectDocumentType('pic.jpg', 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0])),
      ).toEqual({ extension: 'jpg', mimeType: 'image/jpeg' })
      expect(
        detectDocumentType('pic.jpeg', 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe1])),
      ).toEqual({ extension: 'jpeg', mimeType: 'image/jpeg' })
    })

    it('rejects an extension outside the allowlist', () => {
      expect(
        detectDocumentType('virus.exe', 'application/octet-stream', Buffer.from('MZ')),
      ).toBeNull()
    })

    it('rejects a renamed executable whose magic contradicts the extension', () => {
      expect(
        detectDocumentType('contract.pdf', 'application/octet-stream', Buffer.from('MZ\x90\x00')),
      ).toBeNull()
    })

    it('rejects a truncated or empty header', () => {
      expect(detectDocumentType('contract.pdf', 'application/pdf', Buffer.alloc(0))).toBeNull()
    })

    it('ignores case in the extension', () => {
      expect(
        detectDocumentType('CONTRACT.PDF', 'application/pdf', Buffer.from('%PDF-1.7')),
      ).toEqual({ extension: 'pdf', mimeType: 'application/pdf' })
    })
  })
})
