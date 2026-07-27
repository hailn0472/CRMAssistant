import { Injectable } from '@nestjs/common'
import { Readable } from 'stream'

import { resolveSharedRecordIds } from '../common/guards/sharing-check'
import { resolveVisibilityFilter } from '../common/guards/visibility-check'
import { PrismaService } from '../prisma/prisma.service'
import type { Prisma } from '@prisma/client'

export type ExportFilters = {
  tags?: string
  company?: string
  search?: string
  jobTitle?: string
  createdAtFrom?: string
  createdAtTo?: string
}

/** Rows fetched per database round-trip while streaming. */
const CHUNK_SIZE = 500

/** Values that only look dangerous: an international phone number, e.g. +84123456789. */
const PHONE_LIKE = /^\+?\d[\d\s().-]*$/

const CSV_HEADERS = [
  'id',
  'email',
  'firstName',
  'lastName',
  'phone',
  'company',
  'jobTitle',
  'tags',
  'createdAt',
  'updatedAt',
] as const

type ExportedContact = {
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

@Injectable()
export class ExportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Export contacts as a CSV stream, scoped to the caller's tenant *and* their
   * record visibility (own / team / all plus explicitly shared records), matching
   * what ContactsService.findMany returns for the same user.
   *
   * Rows are fetched in chunks and yielded as they arrive, so a large tenant
   * never materialises the whole table — or the whole CSV — in memory.
   */
  async exportContacts(
    tenantId: string,
    userId: string,
    filters?: ExportFilters,
  ): Promise<Readable> {
    const where = await this.buildWhere(tenantId, userId, filters)
    return Readable.from(this.generateCsvChunks(where))
  }

  private async buildWhere(
    tenantId: string,
    userId: string,
    filters?: ExportFilters,
  ): Promise<Prisma.ContactWhereInput> {
    const where: Prisma.ContactWhereInput = { tenantId, deletedAt: null }
    const andConditions: Prisma.ContactWhereInput[] = []

    const visibilityFilter = await resolveVisibilityFilter(userId, tenantId)
    const sharedIds = await resolveSharedRecordIds(userId, tenantId, 'CONTACT')

    // When visibilityFilter is undefined (ALL / ADMIN / VIEW_ALL_DATA bypass) the
    // user sees everything and no owner restriction applies.
    const ownerConditions: Prisma.ContactWhereInput[] = []
    if (visibilityFilter !== undefined) {
      ownerConditions.push({ ownerId: visibilityFilter })
      if (sharedIds.length > 0) {
        ownerConditions.push({ id: { in: sharedIds } })
      }
    }
    if (ownerConditions.length > 0) {
      andConditions.push({ OR: ownerConditions })
    }

    const company = filters?.company?.trim()
    if (company) {
      andConditions.push({ company: { contains: company, mode: 'insensitive' } })
    }

    const jobTitle = filters?.jobTitle?.trim()
    if (jobTitle) {
      andConditions.push({ jobTitle: { contains: jobTitle, mode: 'insensitive' } })
    }

    if (filters?.createdAtFrom || filters?.createdAtTo) {
      const createdAtFilter: Prisma.DateTimeFilter = {}
      if (filters.createdAtFrom) {
        createdAtFilter.gte = new Date(filters.createdAtFrom)
      }
      if (filters.createdAtTo) {
        const endDate = new Date(filters.createdAtTo)
        endDate.setHours(23, 59, 59, 999)
        createdAtFilter.lte = endDate
      }
      andConditions.push({ createdAt: createdAtFilter })
    }

    const search = filters?.search?.trim()
    if (search) {
      andConditions.push({
        OR: [
          { email: { contains: search, mode: 'insensitive' } },
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { company: { contains: search, mode: 'insensitive' } },
        ],
      })
    }

    if (filters?.tags) {
      const tagNames = filters.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
      if (tagNames.length > 0) {
        andConditions.push({
          AND: tagNames.map((tagName) => ({
            tags: { some: { tag: { name: tagName } } },
          })),
        })
      }
    }

    if (andConditions.length > 0) {
      where.AND = andConditions
    }

    return where
  }

  private async *generateCsvChunks(where: Prisma.ContactWhereInput): AsyncGenerator<string> {
    yield CSV_HEADERS.join(',') + '\n'

    let cursor: string | undefined

    for (;;) {
      const contacts: ExportedContact[] = await this.prisma.contact.findMany({
        where,
        take: CHUNK_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        // The id tiebreaker keeps the cursor stable when timestamps collide.
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        include: {
          tags: {
            select: { tag: { select: { name: true } } },
          },
        },
      })

      if (contacts.length === 0) return

      yield contacts.map((contact) => this.toCsvRow(contact)).join('')

      if (contacts.length < CHUNK_SIZE) return
      cursor = contacts[contacts.length - 1]!.id
    }
  }

  private toCsvRow(contact: ExportedContact): string {
    const tags = contact.tags.map((t) => t.tag.name).join(';')
    return (
      [
        this.escapeField(contact.id),
        this.escapeField(contact.email),
        this.escapeField(contact.firstName),
        this.escapeField(contact.lastName),
        this.escapeField(contact.phone ?? ''),
        this.escapeField(contact.company ?? ''),
        this.escapeField(contact.jobTitle ?? ''),
        this.escapeField(tags),
        this.escapeField(contact.createdAt.toISOString()),
        this.escapeField(contact.updatedAt.toISOString()),
      ].join(',') + '\n'
    )
  }

  private escapeField(value: string): string {
    // Neutralise spreadsheet formula injection: a leading =, +, - or @ makes
    // Excel/Sheets evaluate the cell when the export is opened. International
    // phone numbers legitimately start with "+", so they are exempt — they carry
    // no expression syntax to execute.
    const dangerous = /^[=+\-@\t\r]/.test(value) && !PHONE_LIKE.test(value)
    const guarded = dangerous ? `'${value}` : value

    if (
      guarded.includes(',') ||
      guarded.includes('"') ||
      guarded.includes('\n') ||
      guarded.includes('\r')
    ) {
      return `"${guarded.replace(/"/g, '""')}"`
    }
    return guarded
  }
}
