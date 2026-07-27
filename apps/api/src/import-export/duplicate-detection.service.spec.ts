import { Prisma } from '@prisma/client'

import { DuplicateDetectionService } from './duplicate-detection.service'
import type { CsvRow } from './dto/import-result.dto'

type MockPrisma = {
  $queryRaw: jest.Mock
}

type ExistingContact = {
  id: string
  email: string
  firstName: string
  lastName: string
}

function makePrisma(): MockPrisma {
  return { $queryRaw: jest.fn().mockResolvedValue([]) }
}

function row(overrides: Partial<CsvRow> = {}): CsvRow {
  return {
    email: 'john@example.com',
    firstName: 'John',
    lastName: 'Doe',
    phone: '',
    company: '',
    jobTitle: '',
    tags: '',
    ...overrides,
  }
}

function existing(overrides: Partial<ExistingContact> = {}): ExistingContact {
  return {
    id: 'contact-1',
    email: 'john@example.com',
    firstName: 'John',
    lastName: 'Doe',
    ...overrides,
  }
}

/** Pulls the parameters Prisma would bind, so tests assert the real query. */
function boundValues(mock: jest.Mock, call = 0): unknown[] {
  const sql = mock.mock.calls[call]![0] as Prisma.Sql
  return sql.values
}

describe('DuplicateDetectionService', () => {
  let service: DuplicateDetectionService
  let prisma: MockPrisma

  const TENANT_ID = 'tenant-1'

  beforeEach(() => {
    prisma = makePrisma()
    service = new DuplicateDetectionService(
      prisma as unknown as ConstructorParameters<typeof DuplicateDetectionService>[0],
    )
  })

  describe('detectDuplicates()', () => {
    it('classifies a row as new when no contact matches the email', async () => {
      prisma.$queryRaw.mockResolvedValue([])

      const result = await service.detectDuplicates(TENANT_ID, [row()])

      expect(result.newRows).toHaveLength(1)
      expect(result.duplicateRows).toHaveLength(0)
      expect(result.invalidRows).toHaveLength(0)
      expect(result.newRows[0]!.rowNumber).toBe(0)
    })

    it('classifies a row as duplicate and carries the existing contact through', async () => {
      prisma.$queryRaw.mockResolvedValue([existing({ id: 'existing-9' })])

      const result = await service.detectDuplicates(TENANT_ID, [row()])

      expect(result.duplicateRows).toHaveLength(1)
      expect(result.duplicateRows[0]!.existingContact).toEqual({
        id: 'existing-9',
        email: 'john@example.com',
        firstName: 'John',
        lastName: 'Doe',
      })
    })

    it('scopes the lookup to the tenant and to the emails being imported', async () => {
      await service.detectDuplicates(TENANT_ID, [
        row({ email: 'a@example.com' }),
        row({ email: 'b@example.com' }),
      ])

      // Asserting the bound parameters means deleting the tenant filter would
      // fail this test, unlike an assertion on the returned shape alone.
      const values = boundValues(prisma.$queryRaw)
      expect(values).toContain(TENANT_ID)
      expect(values).toContain('a@example.com')
      expect(values).toContain('b@example.com')

      const sqlText = (prisma.$queryRaw.mock.calls[0]![0] as Prisma.Sql).sql
      expect(sqlText).toContain('"tenantId"')
      expect(sqlText).toContain('"deletedAt" IS NULL')
      expect(sqlText).toContain('LOWER("email")')
    })

    it('matches case-insensitively against emails stored with different casing', async () => {
      // A contact created as John@Example.com must still be found for a CSV row
      // of john@example.com, or the import silently creates a second record.
      prisma.$queryRaw.mockResolvedValue([existing({ email: 'John@Example.COM' })])

      const result = await service.detectDuplicates(TENANT_ID, [row({ email: 'JOHN@example.com' })])

      expect(result.duplicateRows).toHaveLength(1)
      expect(result.newRows).toHaveLength(0)
    })

    it('lowercases and trims emails before querying', async () => {
      await service.detectDuplicates(TENANT_ID, [row({ email: '  John@Example.COM  ' })])

      expect(boundValues(prisma.$queryRaw)).toContain('john@example.com')
    })

    it('deduplicates the email list sent to the database', async () => {
      await service.detectDuplicates(TENANT_ID, [
        row({ email: 'dup@example.com' }),
        row({ email: 'DUP@example.com' }),
      ])

      const emails = boundValues(prisma.$queryRaw).filter((v) => v !== TENANT_ID)
      expect(emails).toEqual(['dup@example.com'])
    })

    it('detects multiple duplicates within one batch', async () => {
      prisma.$queryRaw.mockResolvedValue([
        existing({ id: 'c1', email: 'a@example.com' }),
        existing({ id: 'c2', email: 'b@example.com' }),
      ])

      const result = await service.detectDuplicates(TENANT_ID, [
        row({ email: 'a@example.com' }),
        row({ email: 'b@example.com' }),
        row({ email: 'c@example.com' }),
      ])

      expect(result.duplicateRows.map((r) => r.email)).toEqual(['a@example.com', 'b@example.com'])
      expect(result.newRows.map((r) => r.email)).toEqual(['c@example.com'])
    })

    it('preserves the original row index on every category', async () => {
      prisma.$queryRaw.mockResolvedValue([existing({ email: 'b@example.com' })])

      const result = await service.detectDuplicates(TENANT_ID, [
        row({ email: 'a@example.com' }),
        row({ email: 'b@example.com' }),
        row({ email: '' }),
      ])

      expect(result.newRows[0]!.rowNumber).toBe(0)
      expect(result.duplicateRows[0]!.rowNumber).toBe(1)
      expect(result.invalidRows[0]!.rowNumber).toBe(2)
    })

    it.each([
      ['an empty email', { email: '' }, 'Empty email'],
      ['a whitespace-only email', { email: '   ' }, 'Empty email'],
      ['an email with no @', { email: 'not-an-email' }, 'Invalid email format'],
      ['an email with no domain dot', { email: 'a@b' }, 'Invalid email format'],
      ['an email with spaces', { email: 'a b@c.com' }, 'Invalid email format'],
      ['a missing firstName', { firstName: '  ' }, 'Missing firstName'],
      ['a missing lastName', { lastName: '' }, 'Missing lastName'],
    ])('marks %s as invalid', async (_label, overrides, reason) => {
      const result = await service.detectDuplicates(TENANT_ID, [row(overrides)])

      expect(result.invalidRows).toHaveLength(1)
      expect(result.invalidRows[0]!.reason).toBe(reason)
      expect(result.newRows).toHaveLength(0)
    })

    it('marks an over-long field as invalid rather than letting the DB reject it', async () => {
      const result = await service.detectDuplicates(TENANT_ID, [row({ company: 'x'.repeat(256) })])

      expect(result.invalidRows[0]!.reason).toContain('company exceeds 255 characters')
    })

    it('does not query the database when every row is invalid', async () => {
      const result = await service.detectDuplicates(TENANT_ID, [
        row({ email: '' }),
        row({ email: 'bad' }),
      ])

      expect(prisma.$queryRaw).not.toHaveBeenCalled()
      expect(result.invalidRows).toHaveLength(2)
    })

    it('returns empty results for an empty input', async () => {
      const result = await service.detectDuplicates(TENANT_ID, [])

      expect(result).toEqual({ newRows: [], duplicateRows: [], invalidRows: [] })
      expect(prisma.$queryRaw).not.toHaveBeenCalled()
    })

    it('runs against the transaction client when one is supplied', async () => {
      const tx = { $queryRaw: jest.fn().mockResolvedValue([]) }

      await service.detectDuplicates(TENANT_ID, [row()], tx as never)

      expect(tx.$queryRaw).toHaveBeenCalledTimes(1)
      expect(prisma.$queryRaw).not.toHaveBeenCalled()
    })
  })
})
