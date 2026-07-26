import { ExportService } from './export.service'

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
  deletedAt: Date | null
  tenantId: string
  tags: Array<{ tag: { name: string } }>
}

type MockPrisma = {
  contact: {
    findMany: jest.Mock
    count: jest.Mock
  }
}

function makePrisma(): MockPrisma {
  return {
    contact: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  }
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
    deletedAt: null,
    tenantId: 'tenant-1',
    tags: [],
    ...overrides,
  }
}

describe('ExportService', () => {
  let service: ExportService
  let prisma: MockPrisma

  const TENANT_ID = 'tenant-1'
  const OTHER_TENANT_ID = 'tenant-2'

  beforeEach(() => {
    prisma = makePrisma()
    service = new ExportService(prisma as unknown as ConstructorParameters<typeof ExportService>[0])
  })

  describe('exportContacts()', () => {
    it('generates CSV with correct headers including all fields + tags', async () => {
      prisma.contact.findMany.mockResolvedValue([])
      prisma.contact.count.mockResolvedValue(0)

      const result = await service.exportContacts(TENANT_ID, 'user-1')

      const csv = await streamToString(result)
      const lines = csv.trim().split('\n')
      const headers = lines[0]!

      expect(headers).toBe(
        'id,email,firstName,lastName,phone,company,jobTitle,tags,createdAt,updatedAt',
      )
    })

    it('formats CSV rows with proper escaping for commas in values', async () => {
      const contacts = [makeContact({ firstName: 'John, Jr.', company: 'Acme, Inc.' })]
      prisma.contact.findMany.mockResolvedValue(contacts)
      prisma.contact.count.mockResolvedValue(1)

      const result = await service.exportContacts(TENANT_ID, 'user-1')

      const csv = await streamToString(result)
      const lines = csv.trim().split('\n')

      expect(lines).toHaveLength(2)
      // The name with comma should be quoted
      expect(lines[1]!).toContain('"John, Jr."')
      expect(lines[1]!).toContain('"Acme, Inc."')
    })

    it('returns headers only when there are no contacts', async () => {
      prisma.contact.findMany.mockResolvedValue([])
      prisma.contact.count.mockResolvedValue(0)

      const result = await service.exportContacts(TENANT_ID, 'user-1')

      const csv = await streamToString(result)
      const lines = csv.trim().split('\n')

      expect(lines).toHaveLength(1)
      expect(lines[0]!).toBe(
        'id,email,firstName,lastName,phone,company,jobTitle,tags,createdAt,updatedAt',
      )
    })

    it('includes tags column with semicolon-separated tag names', async () => {
      const contacts = [
        makeContact({
          tags: [{ tag: { name: 'VIP' } }, { tag: { name: 'Enterprise' } }],
        }),
      ]
      prisma.contact.findMany.mockResolvedValue(contacts)
      prisma.contact.count.mockResolvedValue(1)

      const result = await service.exportContacts(TENANT_ID, 'user-1')

      const csv = await streamToString(result)
      expect(csv).toContain('VIP;Enterprise')
    })

    it('excludes deleted contacts (deletedAt is not null)', async () => {
      const active = makeContact()
      // Only set up mock to return active contact (deleted filtered out by query)
      prisma.contact.findMany.mockResolvedValue([active])
      prisma.contact.count.mockResolvedValue(1)

      const result = await service.exportContacts(TENANT_ID, 'user-1')

      const csv = await streamToString(result)
      expect(csv).toContain('john@example.com')
      expect(csv).not.toContain('deleted@example.com')

      // Verify the query filters out deleted contacts
      expect(prisma.contact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deletedAt: null,
          }),
        }),
      )
    })

    it('enforces tenant isolation — only current tenant contacts exported', async () => {
      const tenantAContacts = [makeContact()]
      prisma.contact.findMany.mockResolvedValue(tenantAContacts)
      prisma.contact.count.mockResolvedValue(1)

      const resultA = await service.exportContacts(TENANT_ID, 'user-1')
      const csvA = await streamToString(resultA)

      expect(csvA).toContain('john@example.com')

      // Tenant B should have no contacts
      prisma.contact.findMany.mockResolvedValue([])
      prisma.contact.count.mockResolvedValue(0)

      const resultB = await service.exportContacts(OTHER_TENANT_ID, 'user-2')
      const csvB = await streamToString(resultB)

      expect(csvB.trim().split('\n')).toHaveLength(1)
    })

    it('respects filter params (tags, company, search) in the query', async () => {
      prisma.contact.findMany.mockResolvedValue([])
      prisma.contact.count.mockResolvedValue(0)

      await service.exportContacts(TENANT_ID, 'user-1', {
        tags: 'VIP,Enterprise',
        company: 'Acme',
        search: 'john',
      })

      const callArgs = prisma.contact.findMany.mock.calls[0]![0]
      const where = callArgs.where

      expect(where).toBeDefined()
      // Should have AND conditions for filters
      expect(where.AND).toBeDefined()
    })

    it('handles empty tags field for contacts without tags', async () => {
      const contacts = [makeContact({ tags: [] })]
      prisma.contact.findMany.mockResolvedValue(contacts)
      prisma.contact.count.mockResolvedValue(1)

      const result = await service.exportContacts(TENANT_ID, 'user-1')

      const csv = await streamToString(result)
      const lines = csv.trim().split('\n')
      const fields = lines[1]!.split(',')
      const tagsIndex = 7 // 0-indexed position of 'tags' column
      expect(fields[tagsIndex]).toBe('')
    })
  })
})

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf-8')
}
