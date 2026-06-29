import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'

import { PrismaService } from '../prisma/prisma.service'
import type { User, UserRole, Prisma } from '@prisma/client'

export type CreateUserInput = {
  email: string
  firstName: string
  lastName: string
  role?: string
  phone?: string
  jobTitle?: string
  department?: string
}

export type UpdateUserInput = {
  email?: string
  firstName?: string
  lastName?: string
  role?: string
  phone?: string | null
  jobTitle?: string | null
  department?: string | null
}

export type UpdateProfileInput = {
  firstName?: string
  lastName?: string
  avatar?: string | null
  phone?: string | null
}

export type UserFilterInput = {
  search?: string
  role?: string
  isActive?: boolean
}

export type UserPaginationInput = {
  page?: number
  pageSize?: number
}

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

const userListSelect = {
  id: true,
  tenantId: true,
  email: true,
  firstName: true,
  lastName: true,
  avatar: true,
  phone: true,
  role: true,
  isActive: true,
  jobTitle: true,
  department: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const

export type UserListItem = Prisma.UserGetPayload<{ select: typeof userListSelect }>

export type UserConnection = {
  items: UserListItem[]
  total: number
  page: number
  pageSize: number
}

const MAX_REQUIRED_FIELD_LENGTH = 100
const MAX_OPTIONAL_FIELD_LENGTH = 200
const VALID_ROLES = ['ADMIN', 'MANAGER', 'SALES_REP']

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

function normalizeRole(role: string | undefined): string | undefined {
  if (role === undefined) {
    return undefined
  }
  const normalized = role.trim().toUpperCase()
  if (!VALID_ROLES.includes(normalized)) {
    throw new BadRequestException(`Role must be one of: ${VALID_ROLES.join(', ')}`)
  }
  return normalized
}

function normalizeCreateInput(input: CreateUserInput): CreateUserInput {
  return {
    email: normalizeEmail(input.email),
    firstName: normalizeRequiredString(input.firstName, 'First name'),
    lastName: normalizeRequiredString(input.lastName, 'Last name'),
    role: normalizeRole(input.role) ?? 'SALES_REP',
    phone: normalizeOptionalString(input.phone, 'Phone') ?? undefined,
    jobTitle: normalizeOptionalString(input.jobTitle, 'Job title') ?? undefined,
    department: normalizeOptionalString(input.department, 'Department') ?? undefined,
  }
}

function normalizeUpdateInput(input: UpdateUserInput): UpdateUserInput {
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
    role: normalizeRole(input.role),
    phone: normalizeOptionalString(input.phone, 'Phone'),
    jobTitle: normalizeOptionalString(input.jobTitle, 'Job title'),
    department: normalizeOptionalString(input.department, 'Department'),
  }
}

function normalizeProfileInput(input: UpdateProfileInput): UpdateProfileInput {
  return {
    firstName:
      input.firstName === undefined
        ? undefined
        : normalizeRequiredString(input.firstName, 'First name'),
    lastName:
      input.lastName === undefined
        ? undefined
        : normalizeRequiredString(input.lastName, 'Last name'),
    avatar: normalizeOptionalString(input.avatar, 'Avatar'),
    phone: normalizeOptionalString(input.phone, 'Phone'),
  }
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, userId: string, input: CreateUserInput): Promise<User> {
    const normalizedInput = normalizeCreateInput(input)

    try {
      return await this.prisma.user.create({
        data: {
          tenantId,
          email: normalizedInput.email,
          firstName: normalizedInput.firstName,
          lastName: normalizedInput.lastName,
          role: normalizedInput.role as UserRole,
          phone: normalizedInput.phone,
          jobTitle: normalizedInput.jobTitle,
          department: normalizedInput.department,
          createdBy: userId,
          updatedBy: userId,
        },
      })
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('User email already exists in this tenant')
      }
      throw error
    }
  }

  async findOne(tenantId: string, id: string): Promise<User> {
    const user = await this.prisma.user.findFirst({
      where: { id, tenantId, deletedAt: null },
    })

    if (!user) {
      throw new NotFoundException('User not found')
    }

    return user
  }

  async findMe(tenantId: string, userId: string): Promise<User> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId, deletedAt: null },
    })

    if (!user) {
      throw new NotFoundException('User not found')
    }

    return user
  }

  async findMany(
    tenantId: string,
    filter: UserFilterInput = {},
    pagination: UserPaginationInput = {},
  ): Promise<UserConnection> {
    const page = Math.max(pagination.page ?? DEFAULT_PAGE, 1)
    const pageSize = Math.min(Math.max(pagination.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)
    const search = filter.search?.trim()
    const role = filter.role?.trim()
    const isActive = filter.isActive

    const where: Prisma.UserWhereInput = {
      tenantId,
      deletedAt: null,
      ...(isActive !== undefined ? { isActive } : {}),
      ...(role ? { role: role as UserRole } : {}),
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: 'insensitive' } },
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    }

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: userListSelect,
      }),
      this.prisma.user.count({ where }),
    ])

    return { items, total, page, pageSize }
  }

  async update(
    tenantId: string,
    userId: string,
    id: string,
    input: UpdateUserInput,
  ): Promise<User> {
    const normalizedInput = normalizeUpdateInput(input)

    try {
      const result = await this.prisma.user.updateMany({
        where: { id, tenantId, deletedAt: null },
        data: { ...normalizedInput, role: normalizedInput.role as UserRole, updatedBy: userId },
      })

      if (result.count === 0) {
        throw new NotFoundException('User not found')
      }

      return await this.findOne(tenantId, id)
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('User email already exists in this tenant')
      }
      throw error
    }
  }

  async updateProfile(tenantId: string, userId: string, input: UpdateProfileInput): Promise<User> {
    const normalizedInput = normalizeProfileInput(input)

    const result = await this.prisma.user.updateMany({
      where: { id: userId, tenantId, deletedAt: null },
      data: { ...normalizedInput, updatedBy: userId },
    })

    if (result.count === 0) {
      throw new NotFoundException('User not found')
    }

    return await this.findOne(tenantId, userId)
  }

  async delete(tenantId: string, userId: string, id: string): Promise<boolean> {
    const result = await this.prisma.user.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: { deletedAt: new Date(), updatedBy: userId },
    })

    if (result.count === 0) {
      throw new NotFoundException('User not found')
    }

    return true
  }

  async deactivate(tenantId: string, userId: string, id: string): Promise<User> {
    const result = await this.prisma.user.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: { isActive: false, updatedBy: userId },
    })

    if (result.count === 0) {
      throw new NotFoundException('User not found')
    }

    return await this.findOne(tenantId, id)
  }

  async reactivate(tenantId: string, userId: string, id: string): Promise<User> {
    const result = await this.prisma.user.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: { isActive: true, updatedBy: userId },
    })

    if (result.count === 0) {
      throw new NotFoundException('User not found')
    }

    return await this.findOne(tenantId, id)
  }

  async deactivateUsers(tenantId: string, userId: string, ids: string[]): Promise<number> {
    const result = await this.prisma.user.updateMany({
      where: { id: { in: ids }, tenantId, deletedAt: null },
      data: { isActive: false, updatedBy: userId },
    })

    return result.count
  }

  async reactivateUsers(tenantId: string, userId: string, ids: string[]): Promise<number> {
    const result = await this.prisma.user.updateMany({
      where: { id: { in: ids }, tenantId, deletedAt: null },
      data: { isActive: true, updatedBy: userId },
    })

    return result.count
  }
}
