import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'
import type { Product, Prisma } from '@prisma/client'

export type CreateProductInput = {
  name: string
  description?: string | null
  price?: number
  currency?: string
  isActive?: boolean
}

export type UpdateProductInput = {
  name?: string
  description?: string | null
  price?: number
  currency?: string
  isActive?: boolean
}

export type ProductFilterInput = {
  search?: string
  includeInactive?: boolean
}

export type ProductPaginationInput = {
  page?: number
  pageSize?: number
}

export type ProductConnection = {
  items: Product[]
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
    throw new BadRequestException('Product name is required')
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw new BadRequestException(`Product name must be at most ${MAX_NAME_LENGTH} characters`)
  }
  return trimmed
}

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    tenantId: string,
    filter: ProductFilterInput = {},
    pagination: ProductPaginationInput = {},
  ): Promise<ProductConnection> {
    const page = Math.max(pagination.page ?? DEFAULT_PAGE, 1)
    const pageSize = Math.min(Math.max(pagination.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)

    const where: Prisma.ProductWhereInput = {
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
      this.prisma.product.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.product.count({ where }),
    ])

    return { items, total, page, pageSize }
  }

  async findOneForTenant(tenantId: string, id: string): Promise<Product> {
    const product = await this.prisma.product.findFirst({
      where: { id, tenantId, deletedAt: null },
    })
    if (!product) {
      throw new NotFoundException('Product not found')
    }
    return product
  }

  async create(tenantId: string, userId: string, input: CreateProductInput): Promise<Product> {
    const name = normalizeName(input.name)

    // Reject duplicate active name (case-insensitive)
    const existing = await this.prisma.product.findFirst({
      where: { tenantId, name: { equals: name, mode: 'insensitive' }, deletedAt: null },
    })
    if (existing) {
      throw new ConflictException('Product name already exists')
    }

    return this.prisma.product.create({
      data: {
        tenantId,
        name,
        description: input.description ?? null,
        price: input.price ?? 0,
        currency: (input.currency ?? 'USD').trim().toUpperCase(),
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
    input: UpdateProductInput,
  ): Promise<Product> {
    await this.findOneForTenant(tenantId, id)

    const data: Record<string, unknown> = { updatedBy: userId }

    if (input.name !== undefined) {
      const name = normalizeName(input.name)

      // Reject duplicate active name (excluding self)
      const existing = await this.prisma.product.findFirst({
        where: {
          tenantId,
          name: { equals: name, mode: 'insensitive' },
          deletedAt: null,
          id: { not: id },
        },
      })
      if (existing) {
        throw new ConflictException('Product name already exists')
      }

      data.name = name
    }

    if (input.description !== undefined) data.description = input.description
    if (input.price !== undefined) data.price = input.price
    if (input.currency !== undefined) data.currency = input.currency.trim().toUpperCase()
    if (input.isActive !== undefined) data.isActive = input.isActive

    const result = await this.prisma.product.updateMany({
      where: { id, tenantId, deletedAt: null },
      data,
    })

    if (result.count === 0) {
      throw new NotFoundException('Product not found')
    }

    return this.findOneForTenant(tenantId, id)
  }
}
