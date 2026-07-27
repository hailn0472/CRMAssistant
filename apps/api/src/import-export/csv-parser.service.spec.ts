import { BadRequestException } from '@nestjs/common'

import { CsvParserService, MAX_IMPORT_ROWS } from './csv-parser.service'

const HEADER = 'email,firstName,lastName,phone,company,jobTitle,tags'

describe('CsvParserService', () => {
  let service: CsvParserService

  beforeEach(() => {
    service = new CsvParserService()
  })

  describe('parse()', () => {
    it('parses a well-formed CSV into typed rows', () => {
      const { rows } = service.parse(
        `${HEADER}\njohn@example.com,John,Doe,+84123456789,Acme Corp,CTO,"VIP,Enterprise"`,
      )

      expect(rows).toHaveLength(1)
      expect(rows[0]).toEqual({
        email: 'john@example.com',
        firstName: 'John',
        lastName: 'Doe',
        phone: '+84123456789',
        company: 'Acme Corp',
        jobTitle: 'CTO',
        tags: 'VIP,Enterprise',
      })
    })

    it('returns nothing for empty content', () => {
      expect(service.parse('')).toEqual({ rows: [], presentColumns: new Set() })
      expect(service.parse('   \n  ')).toEqual({ rows: [], presentColumns: new Set() })
    })

    it('strips a UTF-8 BOM before reading the header', () => {
      const { rows } = service.parse(`﻿email,firstName,lastName\na@b.com,A,B`)

      expect(rows).toHaveLength(1)
      expect(rows[0]!.email).toBe('a@b.com')
    })

    it.each([
      ['LF', '\n'],
      ['CRLF', '\r\n'],
      ['CR', '\r'],
    ])('handles %s line endings', (_label, eol) => {
      const { rows } = service.parse(`email,firstName,lastName${eol}a@b.com,A,B${eol}c@d.com,C,D`)

      expect(rows.map((r) => r.email)).toEqual(['a@b.com', 'c@d.com'])
    })

    it('unescapes RFC 4180 doubled quotes so an exported file can be re-imported', () => {
      // ExportService writes `""` for a literal quote; the previous hand-rolled
      // parser deleted them, making every export -> import round-trip lossy.
      const { rows } = service.parse(
        `email,firstName,lastName,company\na@b.com,A,B,"Acme ""The Best"" Inc"`,
      )

      expect(rows[0]!.company).toBe('Acme "The Best" Inc')
    })

    it('keeps commas inside quoted fields', () => {
      const { rows } = service.parse(`email,firstName,lastName,company\na@b.com,A,B,"Acme, Inc"`)

      expect(rows[0]!.company).toBe('Acme, Inc')
      expect(rows[0]!.lastName).toBe('B')
    })

    it('keeps newlines inside quoted fields', () => {
      const { rows } = service.parse(
        `email,firstName,lastName,company\na@b.com,A,B,"Line one\nLine two"`,
      )

      expect(rows).toHaveLength(1)
      expect(rows[0]!.company).toBe('Line one\nLine two')
    })

    it('auto-detects tab-separated files', () => {
      const { rows } = service.parse(`email\tfirstName\tlastName\na@b.com\tJohn\tDoe`)

      expect(rows[0]).toMatchObject({ email: 'a@b.com', firstName: 'John', lastName: 'Doe' })
    })

    it('accepts headers in any case and trims surrounding whitespace', () => {
      const { rows } = service.parse(`Email,FirstName,LastName\na@b.com,A,B`)

      expect(rows[0]).toMatchObject({ email: 'a@b.com', firstName: 'A', lastName: 'B' })
    })

    it('reports only the columns the file actually contained', () => {
      const { presentColumns } = service.parse(`email,firstName,lastName\na@b.com,A,B`)

      expect(presentColumns).toEqual(new Set(['email', 'firstName', 'lastName']))
      expect(presentColumns.has('phone')).toBe(false)
      expect(presentColumns.has('company')).toBe(false)
      expect(presentColumns.has('jobTitle')).toBe(false)
    })

    it('includes optional columns in presentColumns when they are supplied', () => {
      const { presentColumns } = service.parse(`${HEADER}\na@b.com,A,B,1,Acme,CTO,VIP`)

      expect(presentColumns).toEqual(
        new Set(['email', 'firstName', 'lastName', 'phone', 'company', 'jobTitle', 'tags']),
      )
    })

    it.each(['email', 'firstName', 'lastName'])(
      'rejects a file missing the required %s column',
      (missing) => {
        const headers = ['email', 'firstName', 'lastName'].filter((h) => h !== missing)
        const csv = `${headers.join(',')}\nx,y`

        expect(() => service.parse(csv)).toThrow(BadRequestException)
        expect(() => service.parse(csv)).toThrow(`missing required column "${missing}"`)
      },
    )

    it('rejects duplicate header names instead of silently overwriting one', () => {
      expect(() => service.parse(`email,firstName,lastName,email\na@b.com,A,B,c@d.com`)).toThrow(
        BadRequestException,
      )
    })

    it('rejects a row with more columns than the header rather than truncating it', () => {
      // An unescaped comma used to shift every later value one column left.
      expect(() =>
        service.parse(`email,firstName,lastName,company\na@b.com,A,B,Acme, Inc,extra`),
      ).toThrow(BadRequestException)
    })

    it('rejects an unterminated quote instead of swallowing the rest of the file', () => {
      expect(() => service.parse(`email,firstName,lastName\na@b.com,A,"B\nc@d.com,C,D`)).toThrow(
        BadRequestException,
      )
    })

    it('rejects a file exceeding the row cap', () => {
      const rows = Array.from(
        { length: MAX_IMPORT_ROWS + 1 },
        (_, i) => `user${i}@example.com,A,B`,
      ).join('\n')

      expect(() => service.parse(`email,firstName,lastName\n${rows}`)).toThrow(
        `the maximum is ${MAX_IMPORT_ROWS}`,
      )
    })

    it('skips blank lines between records', () => {
      const { rows } = service.parse(`email,firstName,lastName\na@b.com,A,B\n\nc@d.com,C,D\n`)

      expect(rows.map((r) => r.email)).toEqual(['a@b.com', 'c@d.com'])
    })

    it('defaults absent optional fields to empty strings', () => {
      const { rows } = service.parse(`email,firstName,lastName\na@b.com,A,B`)

      expect(rows[0]).toEqual({
        email: 'a@b.com',
        firstName: 'A',
        lastName: 'B',
        phone: '',
        company: '',
        jobTitle: '',
        tags: '',
      })
    })
  })
})
