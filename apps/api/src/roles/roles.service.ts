import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import type { Role, UserRole } from '@prisma/client'

export type CreateRoleInput = {
  name: string
  description?: string
}

export type UpdateRoleInput = {
  name?: string
  description?: string
}

export type RoleWithUserCount = Role & { _count: { userRoles: number } }

const MAX_NAME_LENGTH = 100
const MAX_DESCRIPTION_LENGTH = 500

function normalizeName(name: string, fieldName: string): string {
  const normalized = name.trim()
  if (!normalized) {
    throw new BadRequestException(`${fieldName} is required`)
  }
  if (normalized.length > MAX_NAME_LENGTH) {
    throw new BadRequestException(`${fieldName} must be at most ${MAX_NAME_LENGTH} characters`)
  }
  return normalized
}

function normalizeDescription(value: string | null | undefined): string | null | undefined {
  if (value === null) {
    return null
  }
  if (value === undefined) {
    return undefined
  }
  const normalized = value.trim()
  if (!normalized) {
    return null
  }
  if (normalized.length > MAX_DESCRIPTION_LENGTH) {
    throw new BadRequestException(
      `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters`,
    )
  }
  return normalized
}

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(tenantId: string, actorId: string, input: CreateRoleInput): Promise<Role> {
    const name = normalizeName(input.name, 'Role name')
    const description = normalizeDescription(input.description) ?? undefined

    try {
      const role = await this.prisma.role.create({
        data: {
          tenantId,
          name,
          description,
          isSystem: false,
          createdBy: actorId,
          updatedBy: actorId,
        },
      })

      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'ROLE_CREATED',
        entity: 'Role',
        entityId: role.id,
        details: { name: role.name },
      })

      return role
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Role name already exists in this tenant')
      }
      throw error
    }
  }

  async findOne(tenantId: string, id: string): Promise<Role> {
    const role = await this.prisma.role.findFirst({
      where: { id, tenantId, deletedAt: null },
    })

    if (!role) {
      throw new NotFoundException('Role not found')
    }

    return role
  }

  async findMany(tenantId: string): Promise<RoleWithUserCount[]> {
    return this.prisma.role.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { userRoles: true } },
      },
    })
  }

  async update(
    tenantId: string,
    actorId: string,
    id: string,
    input: UpdateRoleInput,
  ): Promise<Role> {
    const role = await this.findOne(tenantId, id)

    if (role.isSystem && input.name !== undefined) {
      throw new ForbiddenException('System roles cannot be renamed')
    }

    const name = input.name !== undefined ? normalizeName(input.name, 'Role name') : undefined
    const description = normalizeDescription(input.description)

    try {
      const updated = await this.prisma.role.update({
        where: { id },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(description !== undefined ? { description } : {}),
          updatedBy: actorId,
        },
      })

      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'ROLE_UPDATED',
        entity: 'Role',
        entityId: id,
        details: { changes: input },
      })

      return updated
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Role name already exists in this tenant')
      }
      throw error
    }
  }

  async delete(tenantId: string, actorId: string, id: string): Promise<boolean> {
    const role = await this.findOne(tenantId, id)

    if (role.isSystem) {
      throw new ForbiddenException('System roles cannot be deleted')
    }

    // Soft delete: set deletedAt
    await this.prisma.role.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: actorId },
    })

    await this.auditService.log({
      tenantId,
      userId: actorId,
      action: 'ROLE_DELETED',
      entity: 'Role',
      entityId: id,
      details: { name: role.name },
    })

    return true
  }

  async assignRoleToUser(
    tenantId: string,
    actorId: string,
    userId: string,
    roleId: string,
  ): Promise<UserRole> {
    // Verify both user and role belong to this tenant
    const [user, role] = await Promise.all([
      this.prisma.user.findFirst({
        where: { id: userId, tenantId, deletedAt: null },
      }),
      this.prisma.role.findFirst({
        where: { id: roleId, tenantId, deletedAt: null },
      }),
    ])

    if (!user) {
      throw new NotFoundException('User not found')
    }
    if (!role) {
      throw new NotFoundException('Role not found')
    }

    try {
      const assignment = await this.prisma.userRole.create({
        data: {
          userId,
          roleId,
          assignedBy: actorId,
        },
      })

      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'ROLE_ASSIGNED',
        entity: 'UserRole',
        entityId: `${userId}:${roleId}`,
        details: { userId, roleId, roleName: role.name },
      })

      return assignment
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('User already has this role assigned')
      }
      throw error
    }
  }

  async removeRoleFromUser(
    tenantId: string,
    actorId: string,
    userId: string,
    roleId: string,
  ): Promise<boolean> {
    // Verify user exists in tenant
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId, deletedAt: null },
    })

    if (!user) {
      throw new NotFoundException('User not found')
    }

    try {
      await this.prisma.userRole.delete({
        where: {
          userId_roleId: { userId, roleId },
        },
      })
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('User does not have this role assigned')
      }
      throw error
    }

    const role = await this.prisma.role.findUnique({ where: { id: roleId } })

    await this.auditService.log({
      tenantId,
      userId: actorId,
      action: 'ROLE_REMOVED',
      entity: 'UserRole',
      entityId: `${userId}:${roleId}`,
      details: { userId, roleId, roleName: role?.name ?? 'unknown' },
    })

    return true
  }

  async getUserRoles(
    _tenantId: string,
    userId: string,
  ): Promise<{ id: string; name: string; description: string | null; isSystem: boolean }[]> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId, role: { tenantId: _tenantId, deletedAt: null } },
      include: {
        role: {
          select: { id: true, name: true, description: true, isSystem: true },
        },
      },
    })

    const filteredRoles = userRoles.filter((ur) => {
      return ur.role !== null
    })

    return filteredRoles.map((ur) => ({
      id: ur.role.id,
      name: ur.role.name,
      description: ur.role.description,
      isSystem: ur.role.isSystem,
    }))
  }

  async getUsersForRole(
    tenantId: string,
    roleId: string,
  ): Promise<{ id: string; email: string; firstName: string; lastName: string }[]> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { roleId, role: { tenantId, deletedAt: null } },
      include: {
        user: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
      },
    })

    return userRoles
      .filter((ur) => ur.user !== null)
      .map((ur) => ({
        id: ur.user.id,
        email: ur.user.email,
        firstName: ur.user.firstName,
        lastName: ur.user.lastName,
      }))
  }
}
