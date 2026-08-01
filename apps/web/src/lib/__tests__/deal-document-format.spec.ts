import {
  MAX_UPLOAD_BYTES,
  fileKindLabel,
  formatFileSize,
  validateDocumentFile,
} from '../deal-document-format'

describe('deal-document-format', () => {
  describe('formatFileSize', () => {
    it('formats bytes', () => {
      expect(formatFileSize(0)).toBe('0 B')
      expect(formatFileSize(512)).toBe('512 B')
    })

    it('formats kilobytes and megabytes', () => {
      expect(formatFileSize(1024)).toBe('1.0 KB')
      expect(formatFileSize(10 * 1024 * 1024)).toBe('10 MB')
      expect(formatFileSize(1536)).toBe('1.5 KB')
    })

    it('handles invalid input', () => {
      expect(formatFileSize(NaN)).toBe('0 B')
      expect(formatFileSize(-5)).toBe('0 B')
    })
  })

  describe('fileKindLabel', () => {
    it('maps known mime types to labels', () => {
      expect(fileKindLabel('application/pdf')).toBe('PDF')
      expect(
        fileKindLabel('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      ).toBe('DOCX')
      expect(
        fileKindLabel('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
      ).toBe('XLSX')
      expect(fileKindLabel('image/png')).toBe('PNG')
      expect(fileKindLabel('image/jpeg')).toBe('JPG')
    })

    it('falls back to FILE for unknown mime types', () => {
      expect(fileKindLabel('application/octet-stream')).toBe('FILE')
    })
  })

  describe('validateDocumentFile', () => {
    it('accepts allowed extensions', () => {
      expect(validateDocumentFile({ name: 'contract.pdf', size: 100 })).toBeNull()
      expect(validateDocumentFile({ name: 'data.XLSX', size: 100 })).toBeNull()
      expect(validateDocumentFile({ name: 'pic.jpeg', size: 100 })).toBeNull()
    })

    it('rejects an unsupported extension with a concrete message', () => {
      expect(validateDocumentFile({ name: 'virus.exe', size: 100 })).toBe(
        'Unsupported file type ".exe". Allowed: PDF, DOCX, XLSX, PNG, JPG',
      )
    })

    it('rejects a file without an extension', () => {
      expect(validateDocumentFile({ name: 'README', size: 100 })).toBe(
        'This file has no extension. Only PDF, DOCX, XLSX, PNG and JPG files are accepted.',
      )
    })

    it('rejects an oversize file', () => {
      expect(validateDocumentFile({ name: 'big.pdf', size: MAX_UPLOAD_BYTES + 1 })).toBe(
        'This file is larger than the 10MB limit. Choose a smaller file.',
      )
    })

    it('accepts a file exactly at the limit', () => {
      expect(validateDocumentFile({ name: 'big.pdf', size: MAX_UPLOAD_BYTES })).toBeNull()
    })
  })
})
