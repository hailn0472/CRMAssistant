import { CsvParserService } from './csv-parser.service'

describe('CsvParserService', () => {
  let service: CsvParserService

  beforeEach(() => {
    service = new CsvParserService()
  })

  describe('parse()', () => {
    it('parses valid CSV with all columns into typed row objects', () => {
      const csv = `email,firstName,lastName,phone,company,jobTitle,tags
john@example.com,John,Doe,+123456789,Acme Corp,CTO,"VIP,Enterprise"
jane@example.com,Jane,Smith,+987654321,,Sales Manager,Lead`

      const result = service.parse(csv)
      expect(result).toHaveLength(2)
      expect(result[0]!).toEqual({
        email: 'john@example.com',
        firstName: 'John',
        lastName: 'Doe',
        phone: '+123456789',
        company: 'Acme Corp',
        jobTitle: 'CTO',
        tags: 'VIP,Enterprise',
      })
      expect(result[1]!).toEqual({
        email: 'jane@example.com',
        firstName: 'Jane',
        lastName: 'Smith',
        phone: '+987654321',
        company: '',
        jobTitle: 'Sales Manager',
        tags: 'Lead',
      })
    })

    it('throws error when CSV has missing required column (email)', () => {
      const csv = `firstName,lastName
John,Doe`

      expect(() => service.parse(csv)).toThrow('Invalid CSV: missing required column "email"')
    })

    it('throws error when CSV has missing required column (firstName)', () => {
      const csv = `email,lastName
john@example.com,Doe`

      expect(() => service.parse(csv)).toThrow('Invalid CSV: missing required column "firstName"')
    })

    it('throws error when CSV has missing required column (lastName)', () => {
      const csv = `email,firstName
john@example.com,John`

      expect(() => service.parse(csv)).toThrow('Invalid CSV: missing required column "lastName"')
    })

    it('strips BOM from UTF-8 CSV', () => {
      const csv = '\uFEFFemail,firstName,lastName\njohn@example.com,John,Doe'
      const result = service.parse(csv)
      expect(result).toHaveLength(1)
      expect(result[0]!.email).toBe('john@example.com')
    })

    it('handles CRLF and LF line endings', () => {
      const csv =
        'email,firstName,lastName\r\njohn@example.com,John,Doe\r\njane@example.com,Jane,Smith'
      const result = service.parse(csv)
      expect(result).toHaveLength(2)
      expect(result[0]!.email).toBe('john@example.com')
      expect(result[1]!.email).toBe('jane@example.com')
    })

    it('parses quoted fields containing commas', () => {
      const csv =
        'email,firstName,lastName,company\njohn@example.com,"Doe, John",Smith,"Acme, Inc."'
      const result = service.parse(csv)
      expect(result[0]!.firstName).toBe('Doe, John')
      expect(result[0]!.company).toBe('Acme, Inc.')
    })

    it('returns empty array for CSV with headers only (no data rows)', () => {
      const csv = 'email,firstName,lastName,phone,company,jobTitle,tags'
      const result = service.parse(csv)
      expect(result).toEqual([])
    })

    it('trims whitespace from field values', () => {
      const csv = 'email,firstName,lastName\n  john@example.com ,  John  ,  Doe  '
      const result = service.parse(csv)
      expect(result[0]!.email).toBe('john@example.com')
      expect(result[0]!.firstName).toBe('John')
      expect(result[0]!.lastName).toBe('Doe')
    })

    it('accepts TSV (tab-separated values)', () => {
      const csv = 'email\tfirstName\tlastName\njohn@example.com\tJohn\tDoe'
      const result = service.parse(csv)
      expect(result).toHaveLength(1)
      expect(result[0]!.email).toBe('john@example.com')
    })

    it('handles quoted values containing newlines', () => {
      const csv = 'email,firstName,lastName,notes\njohn@example.com,John,Doe,"Line1\nLine2\nLine3"'
      const result = service.parse(csv)
      expect(result).toHaveLength(1)
      expect(result[0]!.email).toBe('john@example.com')
    })
  })
})
