import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'

export type CreateCompetitorInput = {
  name: string
  website?: string | null
  strengths?: string | null
  weaknesses?: string | null
  isActive?: boolean
}

export type UpdateCompetitorInput = {
  name?: string
  website?: string | null
  strengths?: string | null
  weaknesses?: string | null
  isActive?: boolean
}

export type CompetitorFilterInput = {
  search?: string
  includeInactive?: boolean
}

export type CompetitorPaginationInput = {
  page?: number
  pageSize?: number
}

export type CompetitorConnection = {
  items: Record<string, unknown>[]
  total: number
  page: number
  pageSize: number
}

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100
const MAX_NAME_LENGTH = 200

function normalizeName(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new BadRequestException('Competitor name is required')
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw new BadRequestException(`Competitor name must be at most ${MAX_NAME_LENGTH} characters`)
  }
  return trimmed
}

@Injectable()
export class CompetitorsService {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    tenantId: string,
    filter: CompetitorFilterInput = {},
    pagination: CompetitorPaginationInput = {},
  ): Promise<CompetitorConnection> {
    const page = Math.max(pagination.page ?? DEFAULT_PAGE, 1)
    const pageSize = Math.min(Math.max(pagination.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)

    const where: Record<string, unknown> = {
      tenantId,
      deletedAt: null,
    }

    const includeInactive = filter.includeInactive ?? false
    if (!includeInactive) {
      where.isActive = true
    }

    if (filter.search?.trim()) {
      where.name = { contains: filter.search.trim(), mode: 'insensitive' }
    }

    const [items, total] = await Promise.all([
      this.prisma.competitor.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.competitor.count({ where }),
    ])

    return { items, total, page, pageSize }
  }

  async findOne(tenantId: string, id: string): Promise<Record<string, unknown>> {
    const competitor = await this.prisma.competitor.findFirst({
      where: { id, tenantId, deletedAt: null },
    })
    if (!competitor) {
      throw new NotFoundException('Competitor not found')
    }
    return competitor
  }

  async create(
    tenantId: string,
    userId: string,
    input: CreateCompetitorInput,
  ): Promise<Record<string, unknown>> {
    const name = normalizeName(input.name)

    // Reject duplicate active name (case-insensitive) — no DB unique constraint
    const existing = await this.prisma.competitor.findFirst({
      where: { tenantId, name: { equals: name, mode: 'insensitive' }, deletedAt: null },
    })
    if (existing) {
      throw new ConflictException('Competitor name already exists')
    }

    return this.prisma.competitor.create({
      data: {
        tenantId,
        name,
        website: input.website ?? null,
        strengths: input.strengths ?? null,
        weaknesses: input.weaknesses ?? null,
        isActive: input.isActive ?? true,
        createdBy: userId,
        updatedBy: userId,
      },
    })
  }

  async update(
    tenantId: string,
    userId: string,
    id: string,
    input: UpdateCompetitorInput,
  ): Promise<Record<string, unknown>> {
    await this.findOne(tenantId, id)

    const data: Record<string, unknown> = { updatedBy: userId }

    if (input.name !== undefined) {
      const name = normalizeName(input.name)

      // Reject duplicate active name (excluding self)
      const existing = await this.prisma.competitor.findFirst({
        where: {
          tenantId,
          name: { equals: name, mode: 'insensitive' },
          deletedAt: null,
          id: { not: id },
        },
      })
      if (existing) {
        throw new ConflictException('Competitor name already exists')
      }

      data.name = name
    }

    if (input.website !== undefined) data.website = input.website
    if (input.strengths !== undefined) data.strengths = input.strengths
    if (input.weaknesses !== undefined) data.weaknesses = input.weaknesses
    if (input.isActive !== undefined) data.isActive = input.isActive

    const result = await this.prisma.competitor.updateMany({
      where: { id, tenantId, deletedAt: null },
      data,
    })

    if (result.count === 0) {
      throw new NotFoundException('Competitor not found')
    }

    return this.findOne(tenantId, id)
  }

  async delete(tenantId: string, userId: string, id: string): Promise<boolean> {
    // Soft delete — never a hard delete
    const result = await this.prisma.competitor.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: { deletedAt: new Date(), updatedBy: userId },
    })

    if (result.count === 0) {
      throw new NotFoundException('Competitor not found')
    }

    return true
  }
}
