import { resolveSharedRecordIds } from '../common/guards/sharing-check'
import { resolveVisibilityFilter } from '../common/guards/visibility-check'
import type { BackgroundMetricsPort } from '../observability/metrics.types'
import { ExportService } from './export.service'
import type { Prisma } from '@prisma/client'

jest.mock('../common/guards/visibility-check', () => ({
  resolveVisibilityFilter: jest.fn(),
}))
jest.mock('../common/guards/sharing-check', () => ({
  resolveSharedRecordIds: jest.fn(),
}))

const mockResolveVisibilityFilter = resolveVisibilityFilter as jest.MockedFunction<
  typeof resolveVisibilityFilter
>
const mockResolveSharedRecordIds = resolveSharedRecordIds as jest.MockedFunction<
  typeof resolveSharedRecordIds
>

type MockContactWithTags = {
  id: string
  email: string
  firstName: string
  lastName: string
  phone: string | null
  company: string | null
  jobTitle: string | null
  createdAt: Date
  updatedAt: Date
  tags: Array<{ tag: { name: string } }>
}

type MockPrisma = {
  contact: { findMany: jest.Mock }
}

function makePrisma(): MockPrisma {
  return { contact: { findMany: jest.fn().mockResolvedValue([]) } }
}

function makeContact(overrides: Partial<MockContactWithTags> = {}): MockContactWithTags {
  return {
    id: 'contact-1',
    email: 'john@example.com',
    firstName: 'John',
    lastName: 'Doe',
    phone: '+123456789',
    company: 'Acme Corp',
    jobTitle: 'CTO',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-06-01T00:00:00Z'),
    tags: [],
    ...overrides,
  }
}

async function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  let out = ''
  for await (const chunk of stream) out += chunk.toString()
  return out
}

/** Flattens the nested AND conditions the service builds, for precise assertions. */
function andConditions(where: Prisma.ContactWhereInput): Prisma.ContactWhereInput[] {
  return (where.AND as Prisma.ContactWhereInput[] | undefined) ?? []
}

describe('ExportService', () => {
  let service: ExportService
  let prisma: MockPrisma
  let backgroundMetrics: BackgroundMetricsPort | undefined

  const TENANT_ID = 'tenant-1'
  const USER_ID = 'user-1'
  const HEADER = 'id,email,firstName,lastName,phone,company,jobTitle,tags,createdAt,updatedAt'

  beforeEach(() => {
    jest.clearAllMocks()
    prisma = makePrisma()
    backgroundMetrics = undefined
    // Default: an unrestricted user (ADMIN / VIEW_ALL_DATA bypass)
    mockResolveVisibilityFilter.mockResolvedValue(undefined)
    mockResolveSharedRecordIds.mockResolvedValue([])
    service = new ExportService(
      prisma as unknown as ConstructorParameters<typeof ExportService>[0],
      backgroundMetrics,
    )
  })

  async function exportCsv(
    filters?: Parameters<ExportService['exportContacts']>[2],
  ): Promise<string> {
    const stream = await service.exportContacts(TENANT_ID, USER_ID, filters)
    return readStream(stream)
  }

  function lastWhere(): Prisma.ContactWhereInput {
    const calls = prisma.contact.findMany.mock.calls
    return calls[calls.length - 1]![0].where as Prisma.ContactWhereInput
  }

  function withMetrics(metrics: BackgroundMetricsPort): void {
    backgroundMetrics = metrics
    service = new ExportService(
      prisma as unknown as ConstructorParameters<typeof ExportService>[0],
      backgroundMetrics,
    )
  }

  describe('CSV generation', () => {
    it('emits headers only when the tenant has no contacts', async () => {
      const csv = await exportCsv()

      expect(csv).toBe(`${HEADER}\n`)
    })

    it('writes every contact field in the documented column order', async () => {
      prisma.contact.findMany.mockResolvedValueOnce([makeContact()])

      const csv = await exportCsv()

      expect(csv.split('\n')[1]).toBe(
        'contact-1,john@example.com,John,Doe,+123456789,Acme Corp,CTO,,2026-01-01T00:00:00.000Z,2026-06-01T00:00:00.000Z',
      )
    })

    it('joins multiple tags with semicolons', async () => {
      prisma.contact.findMany.mockResolvedValueOnce([
        makeContact({ tags: [{ tag: { name: 'VIP' } }, { tag: { name: 'Enterprise' } }] }),
      ])

      const csv = await exportCsv()

      expect(csv).toContain('VIP;Enterprise')
    })

    it('renders null optional fields as empty columns', async () => {
      prisma.contact.findMany.mockResolvedValueOnce([
        makeContact({ phone: null, company: null, jobTitle: null }),
      ])

      const csv = await exportCsv()

      expect(csv.split('\n')[1]).toContain('John,Doe,,,,')
    })

    it.each([
      ['a comma', 'Acme, Inc', '"Acme, Inc"'],
      ['a double quote', 'Acme "Best" Inc', '"Acme ""Best"" Inc"'],
      ['a newline', 'Line one\nLine two', '"Line one\nLine two"'],
    ])('escapes %s in a field', async (_label, company, expected) => {
      prisma.contact.findMany.mockResolvedValueOnce([makeContact({ company })])

      const csv = await exportCsv()

      expect(csv).toContain(expected)
    })

    it.each(['+1+1', '-2+3', '@SUM(A1)', '=1+1'])(
      'neutralises the spreadsheet formula %s',
      async (value) => {
        prisma.contact.findMany.mockResolvedValueOnce([makeContact({ company: value })])

        const csv = await exportCsv()
        const company = csv.split('\n')[1]!.split(',')[5]

        // A leading apostrophe stops Excel/Sheets evaluating the cell.
        expect(company).toBe(`'${value.split(',')[0]}`)
      },
    )

    it('neutralises a formula that also needs quoting', async () => {
      prisma.contact.findMany.mockResolvedValueOnce([
        makeContact({ company: '=HYPERLINK("http://evil","click")' }),
      ])

      const csv = await exportCsv()

      expect(csv).toContain(`"'=HYPERLINK(""http://evil"",""click"")"`)
    })

    it('leaves an international phone number untouched', async () => {
      // "+84..." trips the formula heuristic but carries no expression syntax;
      // prefixing it would corrupt every contact's phone column.
      prisma.contact.findMany.mockResolvedValueOnce([makeContact({ phone: '+84123456789' })])

      const csv = await exportCsv()

      expect(csv).toContain(',+84123456789,')
      expect(csv).not.toContain("'+84123456789")
    })
  })

  describe('tenant and visibility scoping', () => {
    it('always filters by tenant and excludes soft-deleted contacts', async () => {
      await exportCsv()

      const where = lastWhere()
      expect(where.tenantId).toBe(TENANT_ID)
      expect(where.deletedAt).toBeNull()
    })

    it('applies no owner restriction for a user with full visibility', async () => {
      mockResolveVisibilityFilter.mockResolvedValue(undefined)
      mockResolveSharedRecordIds.mockResolvedValue(['shared-1'])

      await exportCsv()

      // An unrestricted user sees everything, so no OR block is added at all.
      expect(andConditions(lastWhere())).toHaveLength(0)
    })

    it('restricts to owned records for a user with OWN visibility', async () => {
      mockResolveVisibilityFilter.mockResolvedValue(USER_ID)
      mockResolveSharedRecordIds.mockResolvedValue([])

      await exportCsv()

      expect(andConditions(lastWhere())).toContainEqual({ OR: [{ ownerId: USER_ID }] })
    })

    it('restricts to team members for a user with TEAM visibility', async () => {
      mockResolveVisibilityFilter.mockResolvedValue({ in: ['user-1', 'user-2'] })
      mockResolveSharedRecordIds.mockResolvedValue([])

      await exportCsv()

      expect(andConditions(lastWhere())).toContainEqual({
        OR: [{ ownerId: { in: ['user-1', 'user-2'] } }],
      })
    })

    it('includes explicitly shared records alongside the visibility filter', async () => {
      mockResolveVisibilityFilter.mockResolvedValue(USER_ID)
      mockResolveSharedRecordIds.mockResolvedValue(['shared-1', 'shared-2'])

      await exportCsv()

      expect(andConditions(lastWhere())).toContainEqual({
        OR: [{ ownerId: USER_ID }, { id: { in: ['shared-1', 'shared-2'] } }],
      })
    })

    it('resolves visibility for the calling user, not the tenant at large', async () => {
      await exportCsv()

      expect(mockResolveVisibilityFilter).toHaveBeenCalledWith(USER_ID, TENANT_ID)
      expect(mockResolveSharedRecordIds).toHaveBeenCalledWith(USER_ID, TENANT_ID, 'CONTACT')
    })
  })

  describe('filters', () => {
    it('applies a case-insensitive company filter', async () => {
      await exportCsv({ company: 'Acme' })

      expect(andConditions(lastWhere())).toContainEqual({
        company: { contains: 'Acme', mode: 'insensitive' },
      })
    })

    it('applies a case-insensitive jobTitle filter', async () => {
      await exportCsv({ jobTitle: 'CTO' })

      expect(andConditions(lastWhere())).toContainEqual({
        jobTitle: { contains: 'CTO', mode: 'insensitive' },
      })
    })

    it('applies a createdAt range that includes the whole end day', async () => {
      await exportCsv({ createdAtFrom: '2026-01-01', createdAtTo: '2026-01-31' })

      const createdAt = andConditions(lastWhere()).find((c) => 'createdAt' in c)
        ?.createdAt as Prisma.DateTimeFilter

      expect(createdAt.gte).toEqual(new Date('2026-01-01'))
      expect((createdAt.lte as Date).getHours()).toBe(23)
    })

    it('searches across email, first name, last name and company', async () => {
      await exportCsv({ search: 'acme' })

      const search = andConditions(lastWhere()).find(
        (c) => Array.isArray(c.OR) && c.OR.length === 4,
      )
      expect(search?.OR).toEqual([
        { email: { contains: 'acme', mode: 'insensitive' } },
        { firstName: { contains: 'acme', mode: 'insensitive' } },
        { lastName: { contains: 'acme', mode: 'insensitive' } },
        { company: { contains: 'acme', mode: 'insensitive' } },
      ])
    })

    it('requires every requested tag to be present', async () => {
      await exportCsv({ tags: 'VIP, Enterprise' })

      expect(andConditions(lastWhere())).toContainEqual({
        AND: [
          { tags: { some: { tag: { name: 'VIP' } } } },
          { tags: { some: { tag: { name: 'Enterprise' } } } },
        ],
      })
    })

    it('ignores blank filter values', async () => {
      await exportCsv({ company: '   ', search: '', tags: '' })

      expect(andConditions(lastWhere())).toHaveLength(0)
    })
  })

  describe('streaming', () => {
    it('pages through the table with a cursor instead of loading it all at once', async () => {
      const firstPage = Array.from({ length: 500 }, (_, i) =>
        makeContact({ id: `c${i}`, email: `u${i}@example.com` }),
      )
      const secondPage = [makeContact({ id: 'last', email: 'last@example.com' })]

      prisma.contact.findMany.mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage)

      const csv = await exportCsv()

      expect(prisma.contact.findMany).toHaveBeenCalledTimes(2)
      expect(prisma.contact.findMany.mock.calls[0]![0].take).toBe(500)
      expect(prisma.contact.findMany.mock.calls[0]![0].cursor).toBeUndefined()
      // The second page resumes after the last row of the first.
      expect(prisma.contact.findMany.mock.calls[1]![0].cursor).toEqual({ id: 'c499' })
      expect(prisma.contact.findMany.mock.calls[1]![0].skip).toBe(1)
      expect(csv.trim().split('\n')).toHaveLength(502) // header + 501 rows
    })

    it('stops after a partial page', async () => {
      prisma.contact.findMany.mockResolvedValueOnce([makeContact()])

      await exportCsv()

      expect(prisma.contact.findMany).toHaveBeenCalledTimes(1)
    })

    it('orders by creation date with a stable id tiebreaker', async () => {
      await exportCsv()

      expect(prisma.contact.findMany.mock.calls[0]![0].orderBy).toEqual([
        { createdAt: 'desc' },
        { id: 'asc' },
      ])
    })
  })

  describe('background metrics', () => {
    it('records success and full stream duration', async () => {
      const metrics: BackgroundMetricsPort = {
        recordJob: jest.fn(),
        observeJobDuration: jest.fn(),
      }
      withMetrics(metrics)

      await exportCsv()

      expect(metrics.recordJob).toHaveBeenCalledWith({ jobGroup: 'export', outcome: 'success' })
      expect(metrics.observeJobDuration).toHaveBeenCalledWith(
        { jobGroup: 'export', outcome: 'success' },
        expect.any(Number),
      )
    })

    it('records an error when stream generation fails', async () => {
      const metrics: BackgroundMetricsPort = {
        recordJob: jest.fn(),
        observeJobDuration: jest.fn(),
      }
      withMetrics(metrics)
      prisma.contact.findMany.mockRejectedValueOnce(new Error('database unavailable'))

      await expect(exportCsv()).rejects.toThrow('database unavailable')
      expect(metrics.recordJob).toHaveBeenCalledWith({ jobGroup: 'export', outcome: 'error' })
      expect(metrics.observeJobDuration).toHaveBeenCalledWith(
        { jobGroup: 'export', outcome: 'error' },
        expect.any(Number),
      )
    })

    it('keeps export behavior when metric recording throws', async () => {
      const metrics: BackgroundMetricsPort = {
        recordJob: jest.fn(() => {
          throw new Error('metrics unavailable')
        }),
        observeJobDuration: jest.fn(() => {
          throw new Error('metrics unavailable')
        }),
      }
      withMetrics(metrics)

      await expect(exportCsv()).resolves.toContain(HEADER)
    })
  })
})
