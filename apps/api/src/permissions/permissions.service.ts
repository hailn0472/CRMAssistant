import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import type { Permission, RolePermission } from '@prisma/client'

@Injectable()
export class PermissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async getAllPermissions(): Promise<Permission[]> {
    return this.prisma.permission.findMany({
      orderBy: [{ resource: 'asc' }, { action: 'asc' }],
    })
  }

  async getRolePermissions(tenantId: string, roleId: string): Promise<Permission[]> {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, tenantId, deletedAt: null },
    })

    if (!role) {
      throw new NotFoundException('Role not found')
    }

    return this.prisma.permission.findMany({
      where: {
        rolePermissions: {
          some: { roleId },
        },
      },
      orderBy: [{ resource: 'asc' }, { action: 'asc' }],
    })
  }

  async getMyPermissions(
    tenantId: string,
    userId: string,
  ): Promise<{ resource: string; action: string; granted: boolean }[]> {
    const grantedPermissions = await this.prisma.permission.findMany({
      where: {
        rolePermissions: {
          some: {
            role: {
              userRoles: { some: { userId } },
              tenantId,
              deletedAt: null,
            },
          },
        },
      },
      select: { resource: true, action: true },
    })

    const grantedSet = new Set(grantedPermissions.map((p) => `${p.resource}:${p.action}`))

    const allPermissions = await this.prisma.permission.findMany({
      select: { resource: true, action: true },
      orderBy: [{ resource: 'asc' }, { action: 'asc' }],
    })

    return allPermissions.map((p) => ({
      resource: p.resource,
      action: p.action,
      granted: grantedSet.has(`${p.resource}:${p.action}`),
    }))
  }

  async assignPermissionToRole(
    tenantId: string,
    actorId: string,
    roleId: string,
    permissionId: string,
  ): Promise<RolePermission> {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, tenantId, deletedAt: null },
    })

    if (!role) {
      throw new NotFoundException('Role not found')
    }

    const permission = await this.prisma.permission.findUnique({
      where: { id: permissionId },
    })

    if (!permission) {
      throw new NotFoundException('Permission not found')
    }

    try {
      const rp = await this.prisma.rolePermission.create({
        data: { roleId, permissionId },
      })

      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'PERMISSION_ASSIGNED',
        entity: 'RolePermission',
        entityId: `${roleId}:${permissionId}`,
        details: {
          roleName: role.name,
          resource: permission.resource,
          action: permission.action,
        },
      })

      return rp
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ForbiddenException('Permission is already assigned to this role')
      }
      throw error
    }
  }

  async removePermissionFromRole(
    tenantId: string,
    actorId: string,
    roleId: string,
    permissionId: string,
  ): Promise<boolean> {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, tenantId, deletedAt: null },
    })

    if (!role) {
      throw new NotFoundException('Role not found')
    }

    try {
      await this.prisma.rolePermission.delete({
        where: {
          roleId_permissionId: { roleId, permissionId },
        },
      })

      const permission = await this.prisma.permission.findUnique({
        where: { id: permissionId },
      })

      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'PERMISSION_REMOVED',
        entity: 'RolePermission',
        entityId: `${roleId}:${permissionId}`,
        details: {
          roleName: role.name,
          resource: permission?.resource ?? 'unknown',
          action: permission?.action ?? 'unknown',
        },
      })

      return true
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('Permission is not assigned to this role')
      }
      throw error
    }
  }

  async setRolePermissions(
    tenantId: string,
    actorId: string,
    roleId: string,
    permissionIds: string[],
  ): Promise<Permission[]> {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, tenantId, deletedAt: null },
    })

    if (!role) {
      throw new NotFoundException('Role not found')
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } })

      if (permissionIds.length > 0) {
        // Validate all permission IDs exist before creating to avoid FK constraint errors
        const existingCount = await tx.permission.count({
          where: { id: { in: permissionIds } },
        })
        if (existingCount !== permissionIds.length) {
          throw new NotFoundException('One or more permission IDs are invalid')
        }
        await tx.rolePermission.createMany({
          data: permissionIds.map((pid) => ({ roleId, permissionId: pid })),
        })
      }
    })

    await this.auditService.log({
      tenantId,
      userId: actorId,
      action: 'ROLE_PERMISSIONS_SET',
      entity: 'Role',
      entityId: roleId,
      details: { roleName: role.name, permissionIds, count: permissionIds.length },
    })

    return this.getRolePermissions(tenantId, roleId)
  }

  async hasPermission(userId: string, resource: string, action: string): Promise<boolean> {
    const count = await this.prisma.rolePermission.count({
      where: {
        role: {
          userRoles: { some: { userId } },
          deletedAt: null,
        },
        permission: { resource, action },
      },
    })

    return count > 0
  }
}
