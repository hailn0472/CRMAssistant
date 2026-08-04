import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'

import { PrismaService } from '../prisma/prisma.service'
import { AuthService } from '../auth/auth.service'
import { TwoFactorService } from '../auth/two-factor.service'
import { AuditService } from '../audit/audit.service'
import type { User } from '@prisma/client'
import { Prisma } from '@prisma/client'

export type CreateUserInput = {
  email: string
  firstName: string
  lastName: string
  phone?: string
  jobTitle?: string
  department?: string
}

export type UpdateUserInput = {
  email?: string
  firstName?: string
  lastName?: string
  phone?: string | null
  jobTitle?: string | null
  department?: string | null
  teamId?: string | null
}

export type UpdateProfileInput = {
  firstName?: string
  lastName?: string
  avatar?: string | null
  phone?: string | null
}

export type UserFilterInput = {
  search?: string
  isActive?: boolean
  roleId?: string
  teamId?: string
}

export type UserPaginationInput = {
  page?: number
  pageSize?: number
}

export type UserStats = {
  total: number
  active: number
  deactivated: number
  admins: number
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
  isActive: true,
  ssoProvider: true,
  jobTitle: true,
  department: true,
  teamId: true,
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

function normalizeCreateInput(input: CreateUserInput): CreateUserInput {
  return {
    email: normalizeEmail(input.email),
    firstName: normalizeRequiredString(input.firstName, 'First name'),
    lastName: normalizeRequiredString(input.lastName, 'Last name'),
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly twoFactorService: TwoFactorService,
    private readonly auditService: AuditService,
    private readonly authService: AuthService,
  ) {}

  async create(tenantId: string, userId: string, input: CreateUserInput): Promise<User> {
    const normalizedInput = normalizeCreateInput(input)

    try {
      const user = await this.prisma.user.create({
        data: {
          tenantId,
          email: normalizedInput.email,
          firstName: normalizedInput.firstName,
          lastName: normalizedInput.lastName,
          phone: normalizedInput.phone,
          jobTitle: normalizedInput.jobTitle,
          department: normalizedInput.department,
          createdBy: userId,
          updatedBy: userId,
        },
      })

      // Assign default SALES_REP role if it exists for this tenant
      const salesRepRole = await this.prisma.role.findFirst({
        where: { tenantId, name: 'SALES_REP', deletedAt: null },
      })

      if (salesRepRole) {
        const existingAssignment = await this.prisma.userRole.findUnique({
          where: { userId_roleId: { userId: user.id, roleId: salesRepRole.id } },
        })

        if (!existingAssignment) {
          await this.prisma.userRole.create({
            data: {
              userId: user.id,
              roleId: salesRepRole.id,
              assignedBy: userId,
            },
          })
        }
      }

      return user
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('User email already exists in this tenant')
      }
      throw error
    }
  }

  async findOne(tenantId: string, id: string): Promise<User & { userRoles?: unknown[] }> {
    const user = await this.prisma.user.findFirst({
      where: { id, tenantId, deletedAt: null },
    })

    if (!user) {
      throw new NotFoundException('User not found')
    }

    return user
  }

  async findMe(tenantId: string, userId: string): Promise<User & { userRoles?: unknown[] }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId, deletedAt: null },
    })

    if (!user) {
      throw new NotFoundException('User not found')
    }

    return user
  }

  /// Aggregate counters for the users workspace summary cards. Scoped to the
  /// tenant only — user visibility is never restricted per-caller here,
  /// unlike Contact/Task, since managing the user directory itself is an
  /// admin-facing surface.
  async getStats(tenantId: string): Promise<UserStats> {
    const scope: Prisma.UserWhereInput = { tenantId, deletedAt: null }

    const [total, active, admins] = await Promise.all([
      this.prisma.user.count({ where: scope }),
      this.prisma.user.count({ where: { ...scope, isActive: true } }),
      this.prisma.user.count({
        where: { ...scope, userRoles: { some: { role: { name: 'ADMIN' } } } },
      }),
    ])

    return { total, active, deactivated: total - active, admins }
  }

  async findMany(
    tenantId: string,
    filter: UserFilterInput = {},
    pagination: UserPaginationInput = {},
  ): Promise<UserConnection> {
    const page = Math.max(pagination.page ?? DEFAULT_PAGE, 1)
    const pageSize = Math.min(Math.max(pagination.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)
    const search = filter.search?.trim()
    const isActive = filter.isActive

    const where: Prisma.UserWhereInput = {
      tenantId,
      deletedAt: null,
      ...(isActive !== undefined ? { isActive } : {}),
      ...(filter.teamId ? { teamId: filter.teamId } : {}),
      ...(filter.roleId ? { userRoles: { some: { roleId: filter.roleId } } } : {}),
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

    // Validate teamId belongs to same tenant if provided
    if (input.teamId !== undefined && input.teamId !== null) {
      const team = await this.prisma.team.findFirst({
        where: { id: input.teamId, tenantId, deletedAt: null },
      })
      if (!team) {
        throw new NotFoundException('Team not found in this tenant')
      }
    } else if (input.teamId === null) {
      // Allow unsetting teamId
    }

    try {
      const result = await this.prisma.user.updateMany({
        where: { id, tenantId, deletedAt: null },
        data: {
          ...normalizedInput,
          ...(input.teamId !== undefined ? { teamId: input.teamId } : {}),
          updatedBy: userId,
        },
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

  async enable2FA(
    tenantId: string,
    userId: string,
  ): Promise<{
    secret: string
    qrCodeDataUrl: string
    backupCodes: string[]
  }> {
    const user = await this.findOne(tenantId, userId)

    if (user.twoFactorEnabled) {
      throw new BadRequestException('2FA is already enabled')
    }

    const secret = this.twoFactorService.generateSecret()
    const qrCodeDataUrl = await this.twoFactorService.generateQrCodeDataUrl(secret, user.email)
    const backupCodes = this.twoFactorService.generateBackupCodes()
    const hashedBackupCodes = await this.twoFactorService.hashBackupCodes(backupCodes)

    // Store secret and hashed backup codes, but don't enable 2FA yet — user must verify first
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        twoFactorSecret: secret,
        twoFactorBackupCodes: hashedBackupCodes as unknown as Prisma.InputJsonValue,
        updatedBy: userId,
      },
    })

    return { secret, qrCodeDataUrl, backupCodes }
  }

  async verify2FA(
    tenantId: string,
    userId: string,
    code: string,
  ): Promise<{
    success: boolean
  }> {
    const user = await this.findOne(tenantId, userId)

    if (user.twoFactorEnabled) {
      throw new BadRequestException('2FA is already enabled')
    }

    if (!user.twoFactorSecret) {
      throw new BadRequestException('2FA setup not initiated — call enable2FA first')
    }

    const isValid = await this.twoFactorService.verifyTotp(user.twoFactorSecret, code)

    if (!isValid) {
      throw new BadRequestException('Invalid verification code')
    }

    // Use stored backup codes from enable2FA — just enable 2FA
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        twoFactorEnabled: true,
        updatedBy: userId,
      },
    })

    await this.auditService.log({
      tenantId,
      userId,
      action: 'TWO_FACTOR_ENABLED',
      entity: 'User',
      entityId: user.id,
    })

    return { success: true }
  }

  async disable2FA(tenantId: string, userId: string, password: string): Promise<boolean> {
    const passwordValid = await this.authService.verifyPassword(userId, password)
    if (!passwordValid) {
      throw new UnauthorizedException('Mật khẩu không đúng')
    }
    const user = await this.findOne(tenantId, userId)

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorBackupCodes: Prisma.DbNull,
        updatedBy: userId,
      },
    })

    await this.auditService.log({
      tenantId,
      userId,
      action: 'TWO_FACTOR_DISABLED',
      entity: 'User',
      entityId: user.id,
    })

    return true
  }

  async regenerateBackupCodes(
    tenantId: string,
    userId: string,
    password: string,
  ): Promise<string[]> {
    const passwordValid = await this.authService.verifyPassword(userId, password)
    if (!passwordValid) {
      throw new UnauthorizedException('Mật khẩu không đúng')
    }
    const user = await this.findOne(tenantId, userId)

    if (!user.twoFactorEnabled) {
      throw new BadRequestException('2FA is not enabled')
    }

    const backupCodes = this.twoFactorService.generateBackupCodes()
    const hashedBackupCodes = await this.twoFactorService.hashBackupCodes(backupCodes)

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        twoFactorBackupCodes: hashedBackupCodes as unknown as Prisma.InputJsonValue,
        updatedBy: userId,
      },
    })

    await this.auditService.log({
      tenantId,
      userId,
      action: 'TWO_FACTOR_BACKUP_CODES_REGENERATED',
      entity: 'User',
      entityId: user.id,
    })

    return backupCodes
  }

  async updateTenantSettings(
    tenantId: string,
    userId: string,
    enforce2FA: boolean,
  ): Promise<{ enforce2FA: boolean }> {
    // Verify user is ADMIN
    const userRoles = await this.getUserRoles(tenantId, userId)
    const roleNames = userRoles.map((r) => r.name)
    if (!roleNames.includes('ADMIN')) {
      throw new ForbiddenException('Only admins can update tenant settings')
    }

    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { enforce2FA },
    })

    await this.auditService.log({
      tenantId,
      userId,
      action: 'TENANT_SETTINGS_UPDATED',
      entity: 'Tenant',
      entityId: tenant.id,
      details: { enforce2FA },
    })

    return { enforce2FA: tenant.enforce2FA }
  }

  async getUserRoles(_tenantId: string, userId: string): Promise<{ id: string; name: string }[]> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId, role: { tenantId: _tenantId } },
      include: {
        role: {
          select: { id: true, name: true },
        },
      },
    })

    return userRoles
      .filter((ur) => ur.role !== null)
      .map((ur) => ({
        id: ur.role.id,
        name: ur.role.name,
      }))
  }

  async getUserRolesBatch(
    _tenantId: string,
    userIds: string[],
  ): Promise<Map<string, { id: string; name: string }[]>> {
    if (userIds.length === 0) {
      return new Map()
    }

    const userRoles = await this.prisma.userRole.findMany({
      where: { userId: { in: userIds }, role: { tenantId: _tenantId } },
      include: {
        role: {
          select: { id: true, name: true },
        },
      },
    })

    const result = new Map<string, { id: string; name: string }[]>()
    for (const userId of userIds) {
      result.set(userId, [])
    }

    for (const ur of userRoles) {
      if (ur.role !== null) {
        const existing = result.get(ur.userId) ?? []
        existing.push({ id: ur.role.id, name: ur.role.name })
        result.set(ur.userId, existing)
      }
    }

    return result
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
