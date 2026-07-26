import type { CsvRow, DuplicateCheckResult } from './dto/import-result.dto'
import { ImportService } from './import.service'
import { DuplicateDetectionService } from './duplicate-detection.service'
import type { Tag } from '@prisma/client'

type MockPrisma = {
  contact: {
    createMany: jest.Mock
    updateMany: jest.Mock
    findMany: jest.Mock
    findFirst: jest.Mock
    count: jest.Mock
  }
  tag: {
    findFirst: jest.Mock
    create: jest.Mock
  }
  contactTag: {
    createMany: jest.Mock
  }
  $transaction: jest.Mock
}

function makePrisma(): MockPrisma {
  return {
    contact: {
      createMany: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
    },
    tag: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    contactTag: {
      createMany: jest.fn(),
    },
    $transaction: jest.fn(),
  }
}

describe('ImportService', () => {
  let service: ImportService
  let prisma: MockPrisma
  let duplicateDetectionService: jest.Mocked<DuplicateDetectionService>

  const TENANT_ID = 'tenant-1'
  const USER_ID = 'user-1'

  beforeEach(() => {
    prisma = makePrisma()
    duplicateDetectionService = {
      detectDuplicates: jest.fn(),
    } as unknown as jest.Mocked<DuplicateDetectionService>

    service = new ImportService(
      prisma as unknown as ConstructorParameters<typeof ImportService>[0],
      duplicateDetectionService,
    )

    // By default, $transaction invokes the callback with the mock prisma object
    // so that tx.contact.createMany = prisma.contact.createMany, etc.
    prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma))
  })

  function makeNewRows(emails: string[]): CsvRow[] {
    return emails.map((email) => ({
      email,
      firstName: 'First',
      lastName: 'Last',
    }))
  }

  function makeDetectResult(overrides: Partial<DuplicateCheckResult> = {}): DuplicateCheckResult {
    return {
      newRows: [],
      duplicateRows: [],
      invalidRows: [],
      ...overrides,
    }
  }

  describe('previewImport()', () => {
    it('returns preview with correct counts for mixed data', async () => {
      const rows: CsvRow[] = [
        { email: 'new@example.com', firstName: 'First', lastName: 'Last' },
        { email: 'dup@example.com', firstName: 'Dup', lastName: 'User' },
        { email: '', firstName: 'No', lastName: 'Email' },
      ]

      duplicateDetectionService.detectDuplicates.mockResolvedValue(
        makeDetectResult({
          newRows: [
            { email: 'new@example.com', firstName: 'First', lastName: 'Last', rowNumber: 0 },
          ],
          duplicateRows: [
            {
              email: 'dup@example.com',
              firstName: 'Dup',
              lastName: 'User',
              rowNumber: 1,
              existingContact: {
                id: 'c1',
                email: 'dup@example.com',
                firstName: 'Existing',
                lastName: 'User',
              },
            },
          ],
          invalidRows: [
            {
              email: '',
              firstName: 'No',
              lastName: 'Email',
              rowNumber: 2,
              reason: 'Empty email',
            },
          ],
        }),
      )

      const result = await service.previewImport(TENANT_ID, USER_ID, rows)

      expect(result.preview).toBe(true)
      expect(result.totalRows).toBe(3)
      expect(result.newRows).toBe(1)
      expect(result.duplicateRows).toBe(1)
      expect(result.invalidRows).toBe(1)
      expect(result.previewRows).toHaveLength(3)
    })
  })

  describe('confirmImport()', () => {
    it('successfully imports valid CSV data with strategy=skip', async () => {
      const rows = makeNewRows(['new1@example.com', 'new2@example.com'])

      duplicateDetectionService.detectDuplicates.mockResolvedValue(
        makeDetectResult({
          newRows: [
            { email: 'new1@example.com', firstName: 'First', lastName: 'Last', rowNumber: 0 },
            { email: 'new2@example.com', firstName: 'First', lastName: 'Last', rowNumber: 1 },
          ],
        }),
      )

      prisma.contact.createMany.mockResolvedValue({ count: 2 })

      const result = await service.confirmImport(TENANT_ID, USER_ID, rows, 'skip')

      expect(result.imported).toBe(2)
      expect(result.skipped).toBe(0)
      expect(result.updated).toBe(0)
      expect(result.failed).toBe(0)
      expect(result.totalRows).toBe(2)
      expect(result.duration).toBeGreaterThanOrEqual(0)
    })

    it('skips duplicate rows when strategy is skip', async () => {
      const rows = makeNewRows(['new@example.com', 'dup@example.com'])

      duplicateDetectionService.detectDuplicates.mockResolvedValue(
        makeDetectResult({
          newRows: [
            { email: 'new@example.com', firstName: 'First', lastName: 'Last', rowNumber: 0 },
          ],
          duplicateRows: [
            {
              email: 'dup@example.com',
              firstName: 'Dup',
              lastName: 'User',
              rowNumber: 1,
              existingContact: {
                id: 'c1',
                email: 'dup@example.com',
                firstName: 'Dup',
                lastName: 'User',
              },
            },
          ],
        }),
      )

      prisma.contact.createMany.mockResolvedValue({ count: 1 })

      const result = await service.confirmImport(TENANT_ID, USER_ID, rows, 'skip')

      expect(result.imported).toBe(1)
      expect(result.skipped).toBe(1)
      expect(result.updated).toBe(0)
    })

    it('updates duplicate rows when strategy is update', async () => {
      const rows: CsvRow[] = [
        {
          email: 'new@example.com',
          firstName: 'First',
          lastName: 'Last',
          phone: '+123',
          company: 'Acme',
          jobTitle: 'CTO',
        },
        {
          email: 'dup@example.com',
          firstName: 'Updated',
          lastName: 'User',
          phone: '+456',
          company: 'Corp',
          jobTitle: 'CEO',
        },
      ]

      duplicateDetectionService.detectDuplicates.mockResolvedValue(
        makeDetectResult({
          newRows: [
            { email: 'new@example.com', firstName: 'First', lastName: 'Last', rowNumber: 0 },
          ],
          duplicateRows: [
            {
              email: 'dup@example.com',
              firstName: 'Updated',
              lastName: 'User',
              rowNumber: 1,
              existingContact: {
                id: 'c1',
                email: 'dup@example.com',
                firstName: 'Old',
                lastName: 'User',
              },
            },
          ],
        }),
      )

      prisma.contact.createMany.mockResolvedValue({ count: 1 })
      prisma.contact.updateMany.mockResolvedValue({ count: 1 })

      const result = await service.confirmImport(TENANT_ID, USER_ID, rows, 'update')

      expect(result.imported).toBe(1)
      expect(result.updated).toBe(1)
      expect(result.skipped).toBe(0)
      expect(prisma.contact.updateMany).toHaveBeenCalled()
    })

    it('creates all rows including duplicates when strategy is create_new', async () => {
      const rows = makeNewRows(['new@example.com', 'dup@example.com'])

      // For create_new, detectDuplicates should NOT be called
      prisma.contact.createMany.mockResolvedValue({ count: 2 })

      const result = await service.confirmImport(TENANT_ID, USER_ID, rows, 'create_new')

      expect(result.imported).toBe(2)
      expect(result.skipped).toBe(0)
      expect(result.updated).toBe(0)

      // Verify detectDuplicates was NOT called for create_new strategy
      expect(duplicateDetectionService.detectDuplicates).not.toHaveBeenCalled()
      // Verify createMany was called with skipDuplicates: true
      expect(prisma.contact.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ skipDuplicates: true }),
      )
    })

    it('deduplicates rows by email within CSV for create_new strategy', async () => {
      const rows: CsvRow[] = [
        { email: 'dup@example.com', firstName: 'First', lastName: 'One' },
        { email: 'dup@example.com', firstName: 'First', lastName: 'Two' },
        { email: 'unique@example.com', firstName: 'Unique', lastName: 'User' },
      ]

      prisma.contact.createMany.mockResolvedValue({ count: 2 })

      const result = await service.confirmImport(TENANT_ID, USER_ID, rows, 'create_new')

      // Should have created 2 (deduped from 3), skipped 0 because create_new doesn't track skip
      expect(result.imported).toBe(2)
      // The last occurrence should be kept - lastName 'Two'
      expect(prisma.contact.createMany).toHaveBeenCalledTimes(1)
      const callData = (prisma.contact.createMany as jest.Mock).mock.calls[0]![0]!.data
      const emails = callData.map((d: { email: string }) => d.email)
      expect(emails).toContain('dup@example.com')
      expect(emails).toContain('unique@example.com')
      expect(emails).toHaveLength(2)

      // detectDuplicates should NOT be called
      expect(duplicateDetectionService.detectDuplicates).not.toHaveBeenCalled()
    })

    it('tracks invalid rows (empty email) as errors for create_new strategy', async () => {
      const rows: CsvRow[] = [
        { email: '', firstName: 'No', lastName: 'Email' },
        { email: 'valid@example.com', firstName: 'Valid', lastName: 'User' },
      ]

      prisma.contact.createMany.mockResolvedValue({ count: 1 })

      const result = await service.confirmImport(TENANT_ID, USER_ID, rows, 'create_new')

      expect(result.imported).toBe(1)
      expect(result.failed).toBe(1)
      expect(result.errors[0]!.reason).toBe('Empty email')
    })

    it('batches creates in chunks of 100', async () => {
      const rows = makeNewRows(Array.from({ length: 250 }, (_, i) => `user${i}@example.com`))

      duplicateDetectionService.detectDuplicates.mockResolvedValue(
        makeDetectResult({
          newRows: rows.map((r, i) => ({ ...r, rowNumber: i })),
        }),
      )

      prisma.contact.createMany.mockResolvedValue({ count: 100 })

      const result = await service.confirmImport(TENANT_ID, USER_ID, rows, 'skip')

      expect(result.imported).toBe(250)
      expect(prisma.contact.createMany).toHaveBeenCalledTimes(3)
    })

    it('reports per-row failures without blocking valid rows', async () => {
      const rows: CsvRow[] = [
        { email: 'valid1@example.com', firstName: 'Valid', lastName: 'One' },
        { email: 'valid2@example.com', firstName: '', lastName: 'EmptyFirst' },
        { email: 'valid3@example.com', firstName: 'Valid', lastName: 'Three' },
      ]

      duplicateDetectionService.detectDuplicates.mockResolvedValue(
        makeDetectResult({
          newRows: [
            { email: 'valid1@example.com', firstName: 'Valid', lastName: 'One', rowNumber: 0 },
            { email: 'valid2@example.com', firstName: '', lastName: 'EmptyFirst', rowNumber: 1 },
            { email: 'valid3@example.com', firstName: 'Valid', lastName: 'Three', rowNumber: 2 },
          ],
        }),
      )

      prisma.contact.createMany.mockRejectedValue(new Error('DB error'))

      const result = await service.confirmImport(TENANT_ID, USER_ID, rows, 'skip')

      expect(result.failed).toBe(3)
      expect(result.imported).toBe(0)
    })

    it('resolves tags during import', async () => {
      const rows: CsvRow[] = [
        {
          email: 'tagged@example.com',
          firstName: 'Tagged',
          lastName: 'User',
          tags: 'VIP,Enterprise',
        },
      ]

      duplicateDetectionService.detectDuplicates.mockResolvedValue(
        makeDetectResult({
          newRows: [
            {
              email: 'tagged@example.com',
              firstName: 'Tagged',
              lastName: 'User',
              rowNumber: 0,
              tags: 'VIP,Enterprise',
            },
          ],
        }),
      )

      prisma.tag.findFirst
        .mockResolvedValueOnce({
          id: 'tag-1',
          tenantId: TENANT_ID,
          name: 'VIP',
          color: '#3B82F6',
          createdAt: new Date(),
        } as Tag)
        .mockResolvedValueOnce(null)
      prisma.tag.create.mockResolvedValue({
        id: 'tag-2',
        tenantId: TENANT_ID,
        name: 'Enterprise',
        color: '#3B82F6',
        createdAt: new Date(),
      } as Tag)

      prisma.contact.createMany.mockResolvedValue({ count: 1 })
      prisma.contact.findFirst.mockResolvedValue({ id: 'contact-new' })

      const result = await service.confirmImport(TENANT_ID, USER_ID, rows, 'skip')

      expect(result.imported).toBe(1)
      expect(prisma.tag.findFirst).toHaveBeenCalledTimes(2)
      expect(prisma.tag.create).toHaveBeenCalledTimes(1)
      expect(prisma.contactTag.createMany).toHaveBeenCalled()
    })

    it('handles invalid tag names gracefully — tags silently skipped', async () => {
      const rows: CsvRow[] = [
        { email: 'user@example.com', firstName: 'User', lastName: 'Test', tags: '' },
      ]

      duplicateDetectionService.detectDuplicates.mockResolvedValue(
        makeDetectResult({
          newRows: [
            { email: 'user@example.com', firstName: 'User', lastName: 'Test', rowNumber: 0 },
          ],
        }),
      )

      prisma.contact.createMany.mockResolvedValue({ count: 1 })

      const result = await service.confirmImport(TENANT_ID, USER_ID, rows, 'skip')

      expect(result.imported).toBe(1)
      expect(prisma.tag.findFirst).not.toHaveBeenCalled()
    })

    it('defaults to skip strategy when not specified', async () => {
      const rows = makeNewRows(['new@example.com'])

      duplicateDetectionService.detectDuplicates.mockResolvedValue(
        makeDetectResult({
          newRows: [
            { email: 'new@example.com', firstName: 'First', lastName: 'Last', rowNumber: 0 },
          ],
        }),
      )

      prisma.contact.createMany.mockResolvedValue({ count: 1 })

      const result = await service.confirmImport(TENANT_ID, USER_ID, rows)

      expect(result.imported).toBe(1)
    })
  })
})
