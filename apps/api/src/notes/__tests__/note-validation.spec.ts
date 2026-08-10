import { BadRequestException } from '@nestjs/common'

import {
  MAX_NOTE_BODY_LENGTH,
  NOTE_PARENTS,
  normalizeNoteBody,
  assertValidNoteBody,
  resolveNoteParent,
} from '../note-validation'

describe('note-validation', () => {
  describe('MAX_NOTE_BODY_LENGTH', () => {
    it('matches mention-parse MAX_COMMENT_LENGTH of 5000', () => {
      expect(MAX_NOTE_BODY_LENGTH).toBe(5000)
    })
  })

  describe('NOTE_PARENTS', () => {
    it('contains CONTACT and DEAL', () => {
      expect(NOTE_PARENTS).toEqual(['CONTACT', 'DEAL'])
    })
  })

  describe('normalizeNoteBody', () => {
    it('trims leading/trailing whitespace', () => {
      expect(normalizeNoteBody('  hello  ')).toBe('hello')
    })

    it('returns empty string when input is whitespace-only', () => {
      expect(normalizeNoteBody('   \t  \n  ')).toBe('')
    })

    it('collapses CRLF to LF', () => {
      expect(normalizeNoteBody('line1\r\nline2\r\nline3')).toBe('line1\nline2\nline3')
    })

    it('collapses standalone CR to LF', () => {
      expect(normalizeNoteBody('line1\rline2')).toBe('line1\nline2')
    })

    it('preserves internal newlines', () => {
      expect(normalizeNoteBody('line1\n\nline2')).toBe('line1\n\nline2')
    })

    it('returns original text when no trimming needed', () => {
      expect(normalizeNoteBody('Hello world')).toBe('Hello world')
    })
  })

  describe('assertValidNoteBody', () => {
    it('throws BadRequestException when body is empty', () => {
      expect(() => assertValidNoteBody('')).toThrow(BadRequestException)
      expect(() => assertValidNoteBody('')).toThrow('Note body is required')
    })

    it('throws BadRequestException when body is whitespace-only (after normalize)', () => {
      const normalized = normalizeNoteBody('   ')
      expect(() => assertValidNoteBody(normalized)).toThrow(BadRequestException)
      expect(() => assertValidNoteBody(normalized)).toThrow('Note body is required')
    })

    it('throws BadRequestException when body exceeds MAX_NOTE_BODY_LENGTH', () => {
      const longBody = 'a'.repeat(MAX_NOTE_BODY_LENGTH + 1)
      expect(() => assertValidNoteBody(longBody)).toThrow(BadRequestException)
      expect(() => assertValidNoteBody(longBody)).toThrow(
        'Note body must not exceed ' + MAX_NOTE_BODY_LENGTH + ' characters',
      )
    })

    it('accepts body at exactly MAX_NOTE_BODY_LENGTH (boundary)', () => {
      const exactlyMax = 'a'.repeat(MAX_NOTE_BODY_LENGTH)
      expect(() => assertValidNoteBody(exactlyMax)).not.toThrow()
    })

    it('accepts body at MAX_NOTE_BODY_LENGTH - 1', () => {
      const oneBelow = 'a'.repeat(MAX_NOTE_BODY_LENGTH - 1)
      expect(() => assertValidNoteBody(oneBelow)).not.toThrow()
    })

    it('accepts body with newlines within limit', () => {
      const body = 'Hello\nWorld\n!'
      expect(() => assertValidNoteBody(body)).not.toThrow()
    })

    it('measures length AFTER normalizing (CRLF counts as LF)', () => {
      // CRLF = 2 raw chars → 1 normalized char (LF)
      // Build a body where raw length exceeds MAX but normalized is exactly MAX
      const prefix = 'A'
      const suffix = 'Z'
      // (MAX - 2) newline pairs so normalized length = 1 + (MAX-2) + 1 = MAX
      const newlinePairs = MAX_NOTE_BODY_LENGTH - 2
      const body = prefix + '\r\n'.repeat(newlinePairs) + suffix
      const normalized = normalizeNoteBody(body)
      expect(normalized.length).toBe(1 + newlinePairs + 1)
      expect(() => assertValidNoteBody(normalized)).not.toThrow()
    })
  })

  describe('resolveNoteParent', () => {
    it('returns CONTACT when only contactId is provided', () => {
      const result = resolveNoteParent({ contactId: 'contact-1' })
      expect(result).toEqual({ parent: 'CONTACT', id: 'contact-1' })
    })

    it('returns DEAL when only dealId is provided', () => {
      const result = resolveNoteParent({ dealId: 'deal-1' })
      expect(result).toEqual({ parent: 'DEAL', id: 'deal-1' })
    })

    it('throws BadRequestException when both contactId and dealId are set', () => {
      expect(() => resolveNoteParent({ contactId: 'contact-1', dealId: 'deal-1' })).toThrow(
        BadRequestException,
      )
      expect(() => resolveNoteParent({ contactId: 'contact-1', dealId: 'deal-1' })).toThrow(
        'A note must be attached to exactly one of contactId or dealId',
      )
    })

    it('throws BadRequestException when neither contactId nor dealId is set', () => {
      expect(() => resolveNoteParent({})).toThrow(BadRequestException)
      expect(() => resolveNoteParent({})).toThrow(
        'A note must be attached to exactly one of contactId or dealId',
      )
    })

    it('throws BadRequestException when both are null', () => {
      expect(() => resolveNoteParent({ contactId: null, dealId: null })).toThrow(
        BadRequestException,
      )
    })

    it('throws BadRequestException when both are undefined', () => {
      expect(() => resolveNoteParent({ contactId: undefined, dealId: undefined })).toThrow(
        BadRequestException,
      )
    })

    it('handles null dealId with valid contactId', () => {
      const result = resolveNoteParent({ contactId: 'contact-1', dealId: null })
      expect(result).toEqual({ parent: 'CONTACT', id: 'contact-1' })
    })

    it('handles null contactId with valid dealId', () => {
      const result = resolveNoteParent({ contactId: null, dealId: 'deal-1' })
      expect(result).toEqual({ parent: 'DEAL', id: 'deal-1' })
    })
  })
})
