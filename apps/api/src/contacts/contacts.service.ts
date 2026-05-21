import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'

import { PrismaService } from '../prisma/prisma.service'
import type { Contact, Prisma } from '@prisma/client'

export type CreateContactInput = {
  email: string
  firstName: string
  lastName: string
  phone?: string
  company?: string
  jobTitle?: string
}

export type UpdateContactInput = {
  email?: string
  firstName?: string
  lastName?: string
  phone?: string | null
  company?: string | null
  jobTitle?: string | null
}

export type ContactFilterInput = {
  search?: string
  company?: string
}

export type ContactPaginationInput = {
  page?: number
  pageSize?: number
}

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

const contactListSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  company: true,
  jobTitle: true,
  createdAt: true,
  updatedAt: true,
} as const

export type ContactListItem = Prisma.ContactGetPayload<{ select: typeof contactListSelect }>

export type ContactConnection = {
  items: ContactListItem[]
  total: number
  page: number
  pageSize: number
}

const MAX_REQUIRED_FIELD_LENGTH = 100
const MAX_OPTIONAL_FIELD_LENGTH = 200

function normalizeRequiredString(value: string, fieldName: string): string {
  const normalizedValue = value.trim()
  if (!normalizedValue) {
    throw new BadRequestException(`${fieldName} is required`)
  }
  if (normalizedValue.length > MAX_REQUIRED_FIELD_LENGTH) {
    throw new BadRequestException(
      `${fieldName} must be at most ${MAX_REQUIRED_FIELD_LENGTH} characters`,
    )
  }
  return normalizedValue
}

function normalizeOptionalString(
  value: string | null | undefined,
  fieldName: string,
): string | null | undefined {
  if (value === null) {
    return null
  }
  if (value === undefined) {
    return undefined
  }

  const normalizedValue = value.trim()
  if (!normalizedValue) {
    return null
  }
  if (normalizedValue.length > MAX_OPTIONAL_FIELD_LENGTH) {
    throw new BadRequestException(
      `${fieldName} must be at most ${MAX_OPTIONAL_FIELD_LENGTH} characters`,
    )
  }
  return normalizedValue
}

function normalizeEmail(email: string): string {
  const normalizedEmail = normalizeRequiredString(email, 'Email').toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new BadRequestException('Email must be valid')
  }
  return normalizedEmail
}

function normalizeCreateInput(input: CreateContactInput): CreateContactInput {
  return {
    email: normalizeEmail(input.email),
    firstName: normalizeRequiredString(input.firstName, 'First name'),
    lastName: normalizeRequiredString(input.lastName, 'Last name'),
    phone: normalizeOptionalString(input.phone, 'Phone') ?? undefined,
    company: normalizeOptionalString(input.company, 'Company') ?? undefined,
    jobTitle: normalizeOptionalString(input.jobTitle, 'Job title') ?? undefined,
  }
}

function normalizeUpdateInput(input: UpdateContactInput): UpdateContactInput {
  return {
    email: input.email === undefined ? undefined : normalizeEmail(input.email),
    firstName:
      input.firstName === undefined
        ? undefined
        : normalizeRequiredString(input.firstName, 'First name'),
    lastName:
      input.lastName === undefined
        ? undefined
        : normalizeRequiredString(input.lastName, 'Last name'),
    phone: normalizeOptionalString(input.phone, 'Phone'),
    company: normalizeOptionalString(input.company, 'Company'),
    jobTitle: normalizeOptionalString(input.jobTitle, 'Job title'),
  }
}

@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, userId: string, input: CreateContactInput): Promise<Contact> {
    const normalizedInput = normalizeCreateInput(input)

    try {
      return await this.prisma.contact.create({
        data: {
          tenantId,
          email: normalizedInput.email,
          firstName: normalizedInput.firstName,
          lastName: normalizedInput.lastName,
          phone: normalizedInput.phone,
          company: normalizedInput.company,
          jobTitle: normalizedInput.jobTitle,
          createdBy: userId,
          updatedBy: userId,
        },
      })
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Contact email already exists')
      }
      throw error
    }
  }

  async findOne(tenantId: string, id: string): Promise<Contact> {
    const contact = await this.prisma.contact.findFirst({
      where: { id, tenantId, deletedAt: null },
    })

    if (!contact) {
      throw new NotFoundException('Contact not found')
    }

    return contact
  }

  async findMany(
    tenantId: string,
    filter: ContactFilterInput = {},
    pagination: ContactPaginationInput = {},
  ): Promise<ContactConnection> {
    const page = Math.max(pagination.page ?? DEFAULT_PAGE, 1)
    const pageSize = Math.min(Math.max(pagination.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)
    const search = filter.search?.trim()
    const company = filter.company?.trim()
    const where: Prisma.ContactWhereInput = {
      tenantId,
      deletedAt: null,
      ...(company ? { company: { contains: company, mode: 'insensitive' } } : {}),
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: 'insensitive' } },
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { company: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    }

    const [items, total] = await Promise.all([
      this.prisma.contact.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: contactListSelect,
      }),
      this.prisma.contact.count({ where }),
    ])

    return { items, total, page, pageSize }
  }

  async update(
    tenantId: string,
    userId: string,
    id: string,
    input: UpdateContactInput,
  ): Promise<Contact> {
    const normalizedInput = normalizeUpdateInput(input)

    try {
      const result = await this.prisma.contact.updateMany({
        where: { id, tenantId, deletedAt: null },
        data: { ...normalizedInput, updatedBy: userId },
      })

      if (result.count === 0) {
        throw new NotFoundException('Contact not found')
      }

      return await this.findOne(tenantId, id)
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Contact email already exists')
      }
      throw error
    }
  }

  async delete(tenantId: string, userId: string, id: string): Promise<boolean> {
    const result = await this.prisma.contact.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: { deletedAt: new Date(), updatedBy: userId },
    })

    if (result.count === 0) {
      throw new NotFoundException('Contact not found')
    }

    return true
  }
}
