import type { CsvRow } from './dto/import-result.dto'
import { DuplicateDetectionService } from './duplicate-detection.service'

type MockContact = {
  id: string
  email: string
  firstName: string
  lastName: string
}

type MockPrisma = {
  contact: {
    findMany: jest.Mock
  }
}

function makePrisma(): MockPrisma {
  return {
    contact: {
      findMany: jest.fn(),
    },
  }
}

describe('DuplicateDetectionService', () => {
  let service: DuplicateDetectionService
  let prisma: MockPrisma

  const TENANT_ID = 'tenant-1'
  const OTHER_TENANT_ID = 'tenant-2'

  beforeEach(() => {
    prisma = makePrisma()
    service = new DuplicateDetectionService(
      prisma as unknown as ConstructorParameters<typeof DuplicateDetectionService>[0],
    )
  })

  describe('detectDuplicates()', () => {
    it('returns no duplicates when email does not exist in tenant', async () => {
      prisma.contact.findMany.mockResolvedValue([])

      const rows: CsvRow[] = [{ email: 'new@example.com', firstName: 'New', lastName: 'User' }]

      const result = await service.detectDuplicates(TENANT_ID, rows)

      expect(result.newRows).toHaveLength(1)
      expect(result.duplicateRows).toHaveLength(0)
      expect(result.invalidRows).toHaveLength(0)
      expect(prisma.contact.findMany).toHaveBeenCalledWith({
        where: {
          tenantId: TENANT_ID,
          email: { in: ['new@example.com'] },
          deletedAt: null,
        },
        select: { id: true, email: true, firstName: true, lastName: true },
      })
    })

    it('detects single duplicate on exact email match', async () => {
      const existing: MockContact = {
        id: 'contact-1',
        email: 'john@example.com',
        firstName: 'John',
        lastName: 'Doe',
      }
      prisma.contact.findMany.mockResolvedValue([existing])

      const rows: CsvRow[] = [{ email: 'john@example.com', firstName: 'John', lastName: 'Doe' }]

      const result = await service.detectDuplicates(TENANT_ID, rows)

      expect(result.newRows).toHaveLength(0)
      expect(result.duplicateRows).toHaveLength(1)
      expect(result.duplicateRows[0]!.existingContact.id).toBe('contact-1')
      expect(result.duplicateRows[0]!.rowNumber).toBe(0)
    })

    it('detects duplicates case-insensitively (John@Example.com vs john@example.com)', async () => {
      const existing: MockContact = {
        id: 'contact-1',
        email: 'john@example.com',
        firstName: 'John',
        lastName: 'Doe',
      }
      prisma.contact.findMany.mockResolvedValue([existing])

      const rows: CsvRow[] = [{ email: 'John@Example.com', firstName: 'John', lastName: 'Doe' }]

      const result = await service.detectDuplicates(TENANT_ID, rows)

      expect(result.newRows).toHaveLength(0)
      expect(result.duplicateRows).toHaveLength(1)
    })

    it('detects multiple duplicates in a single batch', async () => {
      const existing: MockContact[] = [
        { id: 'c1', email: 'one@example.com', firstName: 'One', lastName: 'A' },
        { id: 'c2', email: 'two@example.com', firstName: 'Two', lastName: 'B' },
        { id: 'c3', email: 'three@example.com', firstName: 'Three', lastName: 'C' },
      ]
      prisma.contact.findMany.mockResolvedValue(existing)

      const rows: CsvRow[] = [
        { email: 'one@example.com', firstName: 'One', lastName: 'A' },
        { email: 'two@example.com', firstName: 'Two', lastName: 'B' },
        { email: 'three@example.com', firstName: 'Three', lastName: 'C' },
        { email: 'four@example.com', firstName: 'Four', lastName: 'D' },
      ]

      const result = await service.detectDuplicates(TENANT_ID, rows)

      expect(result.duplicateRows).toHaveLength(3)
      expect(result.newRows).toHaveLength(1)
      expect(result.newRows[0]!.email).toBe('four@example.com')
    })

    it('skips empty emails (no duplicate check)', async () => {
      const rows: CsvRow[] = [{ email: '', firstName: 'No', lastName: 'Email' }]

      const result = await service.detectDuplicates(TENANT_ID, rows)

      expect(result.invalidRows).toHaveLength(1)
      expect(result.invalidRows[0]!.reason).toBe('Empty email')
      expect(result.newRows).toHaveLength(0)
      expect(result.duplicateRows).toHaveLength(0)
      // Should not query DB for empty emails
      expect(prisma.contact.findMany).not.toHaveBeenCalled()
    })

    it('trims whitespace from emails before comparison', async () => {
      const existing: MockContact = {
        id: 'contact-1',
        email: 'john@example.com',
        firstName: 'John',
        lastName: 'Doe',
      }
      prisma.contact.findMany.mockResolvedValue([existing])

      const rows: CsvRow[] = [{ email: '  john@example.com  ', firstName: 'John', lastName: 'Doe' }]

      const result = await service.detectDuplicates(TENANT_ID, rows)

      expect(result.duplicateRows).toHaveLength(1)
      // Verify the query used trimmed email
      expect(prisma.contact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            email: { in: ['john@example.com'] },
          }),
        }),
      )
    })

    it('maintains cross-tenant isolation — tenant A duplicate not flagged for tenant B', async () => {
      prisma.contact.findMany.mockResolvedValue([])

      const rows: CsvRow[] = [{ email: 'existing@co.com', firstName: 'Test', lastName: 'User' }]

      // Tenant B does NOT have this email
      const result = await service.detectDuplicates(OTHER_TENANT_ID, rows)

      expect(result.newRows).toHaveLength(1)
      expect(result.duplicateRows).toHaveLength(0)
    })

    it('handles mixed scenario: new + duplicate + invalid rows', async () => {
      const existing: MockContact = {
        id: 'contact-1',
        email: 'existing@example.com',
        firstName: 'Existing',
        lastName: 'User',
      }
      prisma.contact.findMany.mockResolvedValue([existing])

      const rows: CsvRow[] = [
        { email: 'existing@example.com', firstName: 'Existing', lastName: 'User' },
        { email: '', firstName: 'No', lastName: 'Email' },
        { email: '  new@example.com  ', firstName: 'New', lastName: 'User' },
      ]

      const result = await service.detectDuplicates(TENANT_ID, rows)

      expect(result.duplicateRows).toHaveLength(1)
      expect(result.invalidRows).toHaveLength(1)
      expect(result.newRows).toHaveLength(1)
      expect(result.newRows[0]!.email).toBe('new@example.com')
    })
  })
})
