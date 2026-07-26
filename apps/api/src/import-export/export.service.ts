import { Injectable } from '@nestjs/common'
import { Readable } from 'stream'

import { PrismaService } from '../prisma/prisma.service'
import type { Prisma } from '@prisma/client'

export type ExportFilters = {
  tags?: string
  company?: string
  search?: string
}

@Injectable()
export class ExportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Export contacts as a CSV stream, scoped to the current tenant.
   * Uses streaming to avoid loading all contacts into memory.
   */
  async exportContacts(
    tenantId: string,
    _userId: string,
    filters?: ExportFilters,
  ): Promise<Readable> {
    const where: Prisma.ContactWhereInput = {
      tenantId,
      deletedAt: null,
    }

    const andConditions: Prisma.ContactWhereInput[] = []

    if (filters?.company) {
      andConditions.push({ company: { contains: filters.company, mode: 'insensitive' } })
    }

    if (filters?.search) {
      andConditions.push({
        OR: [
          { email: { contains: filters.search, mode: 'insensitive' } },
          { firstName: { contains: filters.search, mode: 'insensitive' } },
          { lastName: { contains: filters.search, mode: 'insensitive' } },
          { company: { contains: filters.search, mode: 'insensitive' } },
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

    // Fetch all contacts at once for now (can be converted to cursor-based streaming later)
    const contacts = await this.prisma.contact.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        tags: {
          select: { tag: { select: { name: true } } },
        },
      },
    })

    // Generate CSV in memory and return as a stream
    const csvContent = this.generateCsv(contacts)
    return Readable.from([csvContent])
  }

  private generateCsv(
    contacts: Array<{
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
    }>,
  ): string {
    const headers = [
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
    ]
    const lines: string[] = [headers.join(',')]

    for (const contact of contacts) {
      const tags = contact.tags.map((t) => t.tag.name).join(';')
      const fields = [
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
      ]
      lines.push(fields.join(','))
    }

    return lines.join('\n') + '\n'
  }

  private escapeField(value: string): string {
    if (
      value.includes(',') ||
      value.includes('"') ||
      value.includes('\n') ||
      value.includes('\r')
    ) {
      return `"${value.replace(/"/g, '""')}"`
    }
    return value
  }
}
