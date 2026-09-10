import { AuditService } from '../audit/audit.service'
import { DuplicateDetectionService } from './duplicate-detection.service'
import { ImportProgressStore } from './import-progress.store'
import { ImportService } from './import.service'
import type { CsvRow, DuplicateCheckResult, ParsedCsv } from './dto/import-result.dto'
import type { BackgroundMetricsPort } from '../observability/metrics.types'

type MockPrisma = {
  contact: {
    createMany: jest.Mock
    updateMany: jest.Mock
    findMany: jest.Mock
  }
  tag: { upsert: jest.Mock }
  contactTag: { createMany: jest.Mock }
  sharingRule: { findMany: jest.Mock }
  userRole: { count: jest.Mock }
  $transaction: jest.Mock
}

const ALL_COLUMNS = new Set([
  'email',
  'firstName',
  'lastName',
  'phone',
  'company',
  'jobTitle',
  'tags',
])

function makePrisma(): MockPrisma {
  return {
    contact: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    tag: { upsert: jest.fn() },
    contactTag: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    sharingRule: { findMany: jest.fn().mockResolvedValue([]) },
    userRole: { count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn(),
  }
}

function row(email: string, overrides: Partial<CsvRow> = {}): CsvRow {
  return {
    email,
    firstName: 'First',
    lastName: 'Last',
    phone: '',
    company: '',
    jobTitle: '',
    tags: '',
    ...overrides,
  }
}

function parsed(rows: CsvRow[], presentColumns: Set<string> = ALL_COLUMNS): ParsedCsv {
  return { rows, presentColumns }
}

describe('ImportService', () => {
  let service: ImportService
  let prisma: MockPrisma
  let duplicateDetection: jest.Mocked<DuplicateDetectionService>
  let progressStore: ImportProgressStore
  let auditService: { log: jest.Mock }

  const TENANT_ID = 'tenant-1'
  const USER_ID = 'user-1'

  /**
   * Classifies rows the way the real service does, keyed off a set of emails
   * that already exist, so tests describe database state rather than internals.
   */
  function withExisting(existingEmails: string[] = []): void {
    duplicateDetection.detectDuplicates.mockImplementation(
      async (_tenantId: string, rows: CsvRow[]): Promise<DuplicateCheckResult> => {
        const result: DuplicateCheckResult = { newRows: [], duplicateRows: [], invalidRows: [] }

        rows.forEach((r, index) => {
          const rowNumber = (r as CsvRow & { rowNumber?: number }).rowNumber ?? index
          const email = r.email.trim().toLowerCase()

          if (!email) {
            result.invalidRows.push({ ...r, rowNumber, reason: 'Empty email' })
          } else if (existingEmails.includes(email)) {
            result.duplicateRows.push({
              ...r,
              rowNumber,
              existingContact: {
                id: `existing-${email}`,
                email,
                firstName: 'Existing',
                lastName: 'Person',
              },
            })
          } else {
            result.newRows.push({ ...r, rowNumber })
          }
        })

        return result
      },
    )
  }

  beforeEach(() => {
    prisma = makePrisma()
    duplicateDetection = {
      detectDuplicates: jest.fn(),
    } as unknown as jest.Mocked<DuplicateDetectionService>
    progressStore = new ImportProgressStore()
    auditService = { log: jest.fn().mockResolvedValue(undefined) }

    service = new ImportService(
      prisma as unknown as ConstructorParameters<typeof ImportService>[0],
      duplicateDetection,
      progressStore,
      auditService as unknown as AuditService,
    )

    // Each batch runs in its own transaction; the callback receives the mock.
    prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma))
    withExisting([])
  })

  describe('previewImport()', () => {
    it('summarises the three categories', async () => {
      withExisting(['dup@example.com'])

      const result = await service.previewImport(TENANT_ID, USER_ID, [
        row('new@example.com'),
        row('dup@example.com'),
        row(''),
      ])

      expect(result).toMatchObject({
        preview: true,
        totalRows: 3,
        newRows: 1,
        duplicateRows: 1,
        invalidRows: 1,
      })
    })

    it('returns preview rows in file order rather than grouped by status', async () => {
      // Grouping by category used to hide every duplicate behind the first ten
      // new rows — exactly the rows the user opened the preview to inspect.
      withExisting(['dup@example.com'])

      const result = await service.previewImport(TENANT_ID, USER_ID, [
        row('a@example.com'),
        row('dup@example.com'),
        row('b@example.com'),
      ])

      expect(result.previewRows.map((r) => r.status)).toEqual(['new', 'duplicate', 'new'])
    })

    it('numbers rows by their line in the file, counting the header', async () => {
      const result = await service.previewImport(TENANT_ID, USER_ID, [
        row('a@example.com'),
        row('b@example.com'),
      ])

      // First data row is line 2 because line 1 is the header.
      expect(result.previewRows.map((r) => r.rowNumber)).toEqual([2, 3])
    })

    it('caps the payload instead of returning every row of a large file', async () => {
      const rows = Array.from({ length: 500 }, (_, i) => row(`u${i}@example.com`))

      const result = await service.previewImport(TENANT_ID, USER_ID, rows)

      expect(result.totalRows).toBe(500)
      expect(result.previewRows.length).toBeLessThanOrEqual(20)
    })

    it('carries the existing contact through for duplicates', async () => {
      withExisting(['dup@example.com'])

      const result = await service.previewImport(TENANT_ID, USER_ID, [row('dup@example.com')])

      expect(result.previewRows[0]!.existingContact).toMatchObject({
        id: 'existing-dup@example.com',
        email: 'dup@example.com',
      })
    })

    it('carries the rejection reason through for invalid rows', async () => {
      const result = await service.previewImport(TENANT_ID, USER_ID, [row('')])

      expect(result.previewRows[0]).toMatchObject({ status: 'invalid', reason: 'Empty email' })
    })

    it('does not write anything', async () => {
      await service.previewImport(TENANT_ID, USER_ID, [row('a@example.com')])

      expect(prisma.contact.createMany).not.toHaveBeenCalled()
      expect(prisma.contact.updateMany).not.toHaveBeenCalled()
    })
  })

  describe('executeImport() — skip strategy', () => {
    it('creates new contacts and counts duplicates as skipped', async () => {
      withExisting(['dup@example.com'])
      prisma.contact.createMany.mockResolvedValue({ count: 1 })

      const result = await service.executeImport(
        TENANT_ID,
        USER_ID,
        parsed([row('new@example.com'), row('dup@example.com')]),
        'skip',
      )

      expect(result).toMatchObject({ imported: 1, skipped: 1, updated: 0, failed: 0 })
      expect(prisma.contact.updateMany).not.toHaveBeenCalled()
    })

    it('stores emails lowercased so duplicate detection stays reliable', async () => {
      prisma.contact.createMany.mockResolvedValue({ count: 1 })

      await service.executeImport(TENANT_ID, USER_ID, parsed([row('John@Example.COM')]), 'skip')

      expect(prisma.contact.createMany.mock.calls[0]![0].data[0].email).toBe('john@example.com')
    })

    it('stamps ownership and audit fields on created contacts', async () => {
      prisma.contact.createMany.mockResolvedValue({ count: 1 })

      await service.executeImport(TENANT_ID, USER_ID, parsed([row('a@example.com')]), 'skip')

      expect(prisma.contact.createMany.mock.calls[0]![0].data[0]).toMatchObject({
        tenantId: TENANT_ID,
        ownerId: USER_ID,
        createdBy: USER_ID,
        updatedBy: USER_ID,
      })
    })

    it('reports invalid rows as failures against their file line', async () => {
      const result = await service.executeImport(
        TENANT_ID,
        USER_ID,
        parsed([row('a@example.com'), row('')]),
        'skip',
      )

      expect(result.failed).toBe(1)
      expect(result.errors).toContainEqual({ row: 3, reason: 'Empty email' })
    })
  })

  describe('executeImport() — counting', () => {
    it('counts what createMany actually inserted, not the batch size', async () => {
      // skipDuplicates means the database can insert fewer rows than requested;
      // reporting batch.length would overstate the import.
      prisma.contact.createMany.mockResolvedValue({ count: 2 })
      prisma.contact.findMany.mockResolvedValue([])

      const result = await service.executeImport(
        TENANT_ID,
        USER_ID,
        parsed([row('a@example.com'), row('b@example.com'), row('c@example.com')]),
        'skip',
      )

      expect(result.imported).toBe(2)
    })

    it('deduplicates repeated emails within the file and reports the drop', async () => {
      prisma.contact.createMany.mockResolvedValue({ count: 1 })

      const result = await service.executeImport(
        TENANT_ID,
        USER_ID,
        parsed([row('same@example.com'), row('SAME@example.com')]),
        'skip',
      )

      expect(prisma.contact.createMany.mock.calls[0]![0].data).toHaveLength(1)
      expect(result.totalRows).toBe(2)
      expect(result.errors.some((e) => e.reason.includes('duplicate row'))).toBe(true)
    })

    it('processes large files in batches of 100', async () => {
      prisma.contact.createMany.mockResolvedValue({ count: 100 })
      const rows = Array.from({ length: 250 }, (_, i) => row(`u${i}@example.com`))

      await service.executeImport(TENANT_ID, USER_ID, parsed(rows), 'skip')

      expect(prisma.$transaction).toHaveBeenCalledTimes(3)
      expect(prisma.contact.createMany.mock.calls[0]![0].data).toHaveLength(100)
      expect(prisma.contact.createMany.mock.calls[2]![0].data).toHaveLength(50)
    })

    it('gives each batch transaction an explicit timeout', async () => {
      await service.executeImport(TENANT_ID, USER_ID, parsed([row('a@example.com')]), 'skip')

      // Prisma's 5s default would abort any non-trivial import.
      expect(prisma.$transaction.mock.calls[0]![1]).toMatchObject({ timeout: 30_000 })
    })
  })

  describe('executeImport() — update strategy', () => {
    beforeEach(() => {
      withExisting(['dup@example.com'])
      prisma.userRole.count.mockResolvedValue(1) // ADMIN
    })

    it('updates the matched contact and counts it as updated', async () => {
      const result = await service.executeImport(
        TENANT_ID,
        USER_ID,
        parsed([row('dup@example.com', { company: 'Acme' })]),
        'update',
      )

      expect(result).toMatchObject({ imported: 0, updated: 1, skipped: 0 })
      expect(prisma.contact.updateMany).toHaveBeenCalledWith({
        where: { id: 'existing-dup@example.com', tenantId: TENANT_ID },
        data: expect.objectContaining({ company: 'Acme', updatedBy: USER_ID }),
      })
    })

    it('only writes the columns the CSV actually contained', async () => {
      // A three-column file must not wipe phone/company/jobTitle.
      const result = await service.executeImport(
        TENANT_ID,
        USER_ID,
        parsed([row('dup@example.com')], new Set(['email', 'firstName', 'lastName'])),
        'update',
      )

      const data = prisma.contact.updateMany.mock.calls[0]![0].data
      expect(data).toEqual({ updatedBy: USER_ID, firstName: 'First', lastName: 'Last' })
      expect(data).not.toHaveProperty('phone')
      expect(data).not.toHaveProperty('company')
      expect(data).not.toHaveProperty('jobTitle')
      expect(result.updated).toBe(1)
    })

    it('clears a column that is present but empty', async () => {
      await service.executeImport(
        TENANT_ID,
        USER_ID,
        parsed([row('dup@example.com', { phone: '' })], new Set(['email', 'phone'])),
        'update',
      )

      expect(prisma.contact.updateMany.mock.calls[0]![0].data.phone).toBeNull()
    })

    it('refuses to update a contact the user may not edit', async () => {
      prisma.userRole.count.mockResolvedValue(0) // not an admin
      prisma.contact.findMany.mockResolvedValue([]) // owns nothing
      prisma.sharingRule.findMany.mockResolvedValue([]) // no sharing rule

      const result = await service.executeImport(
        TENANT_ID,
        USER_ID,
        parsed([row('dup@example.com')]),
        'update',
      )

      expect(prisma.contact.updateMany).not.toHaveBeenCalled()
      expect(result.updated).toBe(0)
      expect(result.errors).toContainEqual({
        row: 2,
        reason: 'Insufficient permissions to update this contact',
      })
    })

    it('allows the record owner to update without a sharing rule', async () => {
      prisma.userRole.count.mockResolvedValue(0)
      prisma.contact.findMany.mockResolvedValue([
        { id: 'existing-dup@example.com', email: 'dup@example.com', createdAt: new Date() },
      ])

      const result = await service.executeImport(
        TENANT_ID,
        USER_ID,
        parsed([row('dup@example.com')]),
        'update',
      )

      expect(result.updated).toBe(1)
      expect(prisma.sharingRule.findMany).not.toHaveBeenCalled()
    })

    it('allows a user holding an EDIT sharing rule', async () => {
      prisma.userRole.count.mockResolvedValue(0)
      prisma.contact.findMany.mockResolvedValue([])
      prisma.sharingRule.findMany.mockResolvedValue([{ resourceId: 'existing-dup@example.com' }])

      const result = await service.executeImport(
        TENANT_ID,
        USER_ID,
        parsed([row('dup@example.com')]),
        'update',
      )

      expect(result.updated).toBe(1)
      expect(prisma.sharingRule.findMany.mock.calls[0]![0].where).toMatchObject({
        tenantId: TENANT_ID,
        resourceType: 'CONTACT',
        accessLevel: { in: ['EDIT', 'FULL'] },
      })
    })
  })

  describe('executeImport() — create_new strategy', () => {
    it('reports rows whose email already exists as failed instead of silently dropping them', async () => {
      // The tenant-scoped unique index makes a second contact impossible, so the
      // honest outcome is a reported failure, not a phantom "imported" count.
      withExisting(['dup@example.com'])
      prisma.contact.createMany.mockResolvedValue({ count: 1 })

      const result = await service.executeImport(
        TENANT_ID,
        USER_ID,
        parsed([row('new@example.com'), row('dup@example.com')]),
        'create_new',
      )

      expect(result).toMatchObject({ imported: 1, skipped: 0, failed: 1 })
      expect(result.errors).toContainEqual({ row: 3, reason: 'Email already exists' })
    })
  })

  describe('executeImport() — failure handling', () => {
    it('does not report rolled-back rows as imported', async () => {
      prisma.$transaction.mockRejectedValue(new Error('deadlock detected'))

      const result = await service.executeImport(
        TENANT_ID,
        USER_ID,
        parsed([row('a@example.com'), row('b@example.com')]),
        'skip',
      )

      expect(result.imported).toBe(0)
      expect(result.updated).toBe(0)
      expect(result.failed).toBe(2)
      expect(result.errors).toEqual([
        { row: 2, reason: 'deadlock detected' },
        { row: 3, reason: 'deadlock detected' },
      ])
    })

    it('keeps committed batches when a later batch fails', async () => {
      prisma.contact.createMany.mockResolvedValue({ count: 100 })
      let call = 0
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => {
        call++
        if (call === 2) return Promise.reject(new Error('constraint violation'))
        return cb(prisma)
      })

      const rows = Array.from({ length: 200 }, (_, i) => row(`u${i}@example.com`))
      const result = await service.executeImport(TENANT_ID, USER_ID, parsed(rows), 'skip')

      expect(result.imported).toBe(100)
      expect(result.failed).toBe(100)
    })

    it('numbers failure rows monotonically against the file', async () => {
      // The old catch block advanced row numbers by two per iteration.
      prisma.$transaction.mockRejectedValue(new Error('boom'))

      const rows = Array.from({ length: 4 }, (_, i) => row(`u${i}@example.com`))
      const result = await service.executeImport(TENANT_ID, USER_ID, parsed(rows), 'skip')

      expect(result.errors.map((e) => e.row)).toEqual([2, 3, 4, 5])
    })
  })

  describe('executeImport() — tags', () => {
    beforeEach(() => {
      prisma.contact.createMany.mockResolvedValue({ count: 1 })
      prisma.contact.findMany.mockResolvedValue([
        { id: 'contact-1', email: 'a@example.com', createdAt: new Date() },
      ])
      prisma.tag.upsert.mockImplementation(
        ({ where }: { where: { tenantId_name: { name: string } } }) =>
          Promise.resolve({ id: `tag-${where.tenantId_name.name}` }),
      )
    })

    it('resolves tags with an upsert scoped to the tenant', async () => {
      await service.executeImport(
        TENANT_ID,
        USER_ID,
        parsed([row('a@example.com', { tags: 'VIP' })]),
        'skip',
      )

      // upsert cannot raise the P2002 whose swallowed error used to poison the
      // whole transaction.
      expect(prisma.tag.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId_name: { tenantId: TENANT_ID, name: 'VIP' } },
          create: { tenantId: TENANT_ID, name: 'VIP' },
        }),
      )
    })

    it('splits tags on commas and semicolons and upserts each name once', async () => {
      await service.executeImport(
        TENANT_ID,
        USER_ID,
        parsed([row('a@example.com', { tags: 'VIP, Enterprise; VIP' })]),
        'skip',
      )

      expect(prisma.tag.upsert).toHaveBeenCalledTimes(2)
      expect(prisma.contactTag.createMany).toHaveBeenCalledWith({
        data: [
          { contactId: 'contact-1', tagId: 'tag-VIP' },
          { contactId: 'contact-1', tagId: 'tag-Enterprise' },
        ],
        skipDuplicates: true,
      })
    })

    it('links tags to the contact resolved from the write, not a stray email match', async () => {
      prisma.contact.findMany.mockResolvedValue([
        { id: 'the-right-one', email: 'a@example.com', createdAt: new Date() },
      ])

      await service.executeImport(
        TENANT_ID,
        USER_ID,
        parsed([row('a@example.com', { tags: 'VIP' })]),
        'skip',
      )

      expect(prisma.contactTag.createMany.mock.calls[0]![0].data[0].contactId).toBe('the-right-one')
    })

    it('does not touch tag tables when no row carries tags', async () => {
      await service.executeImport(TENANT_ID, USER_ID, parsed([row('a@example.com')]), 'skip')

      expect(prisma.tag.upsert).not.toHaveBeenCalled()
      expect(prisma.contactTag.createMany).not.toHaveBeenCalled()
    })
  })

  describe('executeImport() — audit and progress', () => {
    it('writes an audit entry describing the import', async () => {
      prisma.contact.createMany.mockResolvedValue({ count: 1 })

      await service.executeImport(TENANT_ID, USER_ID, parsed([row('a@example.com')]), 'skip')

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          userId: USER_ID,
          action: 'CONTACT_IMPORTED',
          entity: 'Contact',
          details: expect.objectContaining({ strategy: 'skip', imported: 1 }),
        }),
      )
    })

    it('does not discard a committed import when audit logging fails', async () => {
      prisma.contact.createMany.mockResolvedValue({ count: 1 })
      auditService.log.mockRejectedValue(new Error('audit table offline'))

      const result = await service.executeImport(
        TENANT_ID,
        USER_ID,
        parsed([row('a@example.com')]),
        'skip',
      )

      expect(result.imported).toBe(1)
    })

    it('publishes progress that a poller can read', async () => {
      prisma.contact.createMany.mockResolvedValue({ count: 1 })
      progressStore.start('import-1', TENANT_ID, 1, 1)

      await service.executeImport(
        TENANT_ID,
        USER_ID,
        parsed([row('a@example.com')]),
        'skip',
        'import-1',
      )

      const status = progressStore.get('import-1', TENANT_ID)
      expect(status).toMatchObject({ status: 'completed', progress: { imported: 1 } })
      expect(status!.result).toMatchObject({ imported: 1 })
    })
  })

  describe('startImport()', () => {
    it('returns an import id immediately without waiting for the work', () => {
      const started = service.startImport(
        TENANT_ID,
        USER_ID,
        parsed([row('a@example.com'), row('b@example.com')]),
        'skip',
      )

      expect(started.importId).toEqual(expect.any(String))
      expect(started.totalRows).toBe(2)
      expect(progressStore.get(started.importId, TENANT_ID)).toMatchObject({ status: 'running' })
    })

    it('scopes status lookups to the owning tenant', () => {
      const started = service.startImport(TENANT_ID, USER_ID, parsed([row('a@example.com')]))

      expect(service.getStatus(started.importId, 'other-tenant')).toBeNull()
    })
  })

  describe('background metrics', () => {
    function serviceWithMetrics(metrics: BackgroundMetricsPort): ImportService {
      return new ImportService(
        prisma as unknown as ConstructorParameters<typeof ImportService>[0],
        duplicateDetection,
        progressStore,
        auditService as unknown as AuditService,
        metrics,
      )
    }

    it('records success and duration for a completed import', async () => {
      const metrics: BackgroundMetricsPort = {
        recordJob: jest.fn(),
        observeJobDuration: jest.fn(),
      }
      prisma.contact.createMany.mockResolvedValue({ count: 1 })
      const instrumented = serviceWithMetrics(metrics)

      await expect(
        instrumented.executeImport(TENANT_ID, USER_ID, parsed([row('a@example.com')])),
      ).resolves.toEqual(expect.objectContaining({ imported: 1 }))

      expect(metrics.recordJob).toHaveBeenCalledWith({ jobGroup: 'import', outcome: 'success' })
      expect(metrics.observeJobDuration).toHaveBeenCalledWith(
        { jobGroup: 'import', outcome: 'success' },
        expect.any(Number),
      )
    })

    it('records error when every background batch fails and progress is failed', async () => {
      const metrics: BackgroundMetricsPort = {
        recordJob: jest.fn(),
        observeJobDuration: jest.fn(),
      }
      const importId = 'import-fatal'
      progressStore.start(importId, TENANT_ID, 1, 1)
      prisma.$transaction.mockRejectedValueOnce(new Error('batch unavailable'))
      const instrumented = serviceWithMetrics(metrics)

      await instrumented.executeImport(
        TENANT_ID,
        USER_ID,
        parsed([row('a@example.com')]),
        'skip',
        importId,
      )

      expect(progressStore.get(importId, TENANT_ID)).toMatchObject({ status: 'failed' })
      expect(metrics.recordJob).toHaveBeenCalledWith({ jobGroup: 'import', outcome: 'error' })
      expect(metrics.observeJobDuration).toHaveBeenCalledWith(
        { jobGroup: 'import', outcome: 'error' },
        expect.any(Number),
      )
    })

    it('keeps partial invalid-row results successful and ignores metric failures', async () => {
      const metrics: BackgroundMetricsPort = {
        recordJob: jest.fn(() => {
          throw new Error('metrics unavailable')
        }),
        observeJobDuration: jest.fn(() => {
          throw new Error('metrics unavailable')
        }),
      }
      const instrumented = serviceWithMetrics(metrics)
      prisma.contact.createMany.mockResolvedValue({ count: 1 })

      await expect(
        instrumented.executeImport(TENANT_ID, USER_ID, parsed([row('a@example.com'), row('')])),
      ).resolves.toEqual(expect.objectContaining({ imported: 1, failed: 1 }))
    })
  })
})
