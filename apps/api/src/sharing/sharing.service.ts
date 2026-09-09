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
import type { AccessLevel, ResourceType, SharingRule } from '@prisma/client'

export type CreateSharingInput = {
  resourceType: ResourceType
  resourceId: string
  sharedWithUserId?: string
  sharedWithTeamId?: string
  accessLevel: AccessLevel
}

export type UpdateSharingInput = {
  accessLevel: AccessLevel
}

export type SharingRuleWithDetails = SharingRule

/**
 * Resolves the owner of a given resource by type.
 * Supports CONTACT and DASHBOARD; TASK sharing is future scope.
 */
async function getResourceOwner(
  prisma: PrismaService,
  resourceType: ResourceType,
  resourceId: string,
  tenantId: string,
): Promise<{ ownerId: string }> {
  switch (resourceType) {
    case 'CONTACT': {
      const contact = await prisma.contact.findFirst({
        where: { id: resourceId, tenantId, deletedAt: null },
        select: { ownerId: true },
      })
      if (!contact) throw new NotFoundException('Contact not found')
      return contact
    }
    // DASHBOARD sharing — reuses SharingRule model (arbitrated 2026-08-12)
    case 'DASHBOARD': {
      const dashboard = await prisma.dashboard.findFirst({
        where: { id: resourceId, tenantId, deletedAt: null },
        select: { userId: true },
      })
      if (!dashboard) throw new NotFoundException('Dashboard not found')
      return { ownerId: dashboard.userId }
    }
    case 'TASK':
      throw new BadRequestException(`${resourceType} sharing is not yet implemented`)
    default:
      throw new BadRequestException(`Unknown resource type: ${resourceType as string}`)
  }
}

export type SharingRuleListEntry = SharingRule

@Injectable()
export class SharingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Check if the current user can manage sharing for a record:
   * - ADMIN can manage any sharing rule
   * - Record owner can manage
   * - User who created the share can unshare/update
   */
  async canManageSharing(
    tenantId: string,
    userId: string,
    resourceType: ResourceType,
    resourceId: string,
  ): Promise<boolean> {
    // ADMIN bypass
    const userRoles = await this.prisma.userRole.findMany({
      where: {
        userId,
        role: { tenantId, deletedAt: null },
      },
      include: { role: { select: { name: true } } },
    })
    if (userRoles.some((ur) => ur.role.name === 'ADMIN')) return true

    // Check ownership
    const resource = await getResourceOwner(this.prisma, resourceType, resourceId, tenantId)
    return resource.ownerId === userId
  }

  async create(tenantId: string, userId: string, input: CreateSharingInput): Promise<SharingRule> {
    // Validate exactly one of sharedWithUserId or sharedWithTeamId
    if (!input.sharedWithUserId && !input.sharedWithTeamId) {
      throw new BadRequestException('Either sharedWithUserId or sharedWithTeamId is required')
    }
    if (input.sharedWithUserId && input.sharedWithTeamId) {
      throw new BadRequestException('Cannot share with both user and team simultaneously')
    }

    // Owner check is sufficient because only an owner may create a share.
    // Owner check is sufficient for sharing since only owner can share
    const canManage = await this.canManageSharing(
      tenantId,
      userId,
      input.resourceType,
      input.resourceId,
    )
    if (!canManage) {
      throw new ForbiddenException('Only the record owner can share this record')
    }

    // Validate target user/team exists and belongs to the same tenant
    if (input.sharedWithUserId) {
      if (input.sharedWithUserId === userId) {
        throw new BadRequestException('Cannot share a record with yourself')
      }
      const targetUser = await this.prisma.user.findFirst({
        where: { id: input.sharedWithUserId, tenantId, deletedAt: null },
      })
      if (!targetUser) {
        throw new BadRequestException('Target user not found')
      }
    }
    if (input.sharedWithTeamId) {
      const targetTeam = await this.prisma.team.findFirst({
        where: { id: input.sharedWithTeamId, tenantId, deletedAt: null },
      })
      if (!targetTeam) {
        throw new BadRequestException('Target team not found')
      }
    }

    try {
      const sharingRule = await this.prisma.sharingRule.create({
        data: {
          tenantId,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          sharedWithUserId: input.sharedWithUserId ?? null,
          sharedWithTeamId: input.sharedWithTeamId ?? null,
          accessLevel: input.accessLevel,
          sharedBy: userId,
        },
      })

      await this.auditService.log({
        tenantId,
        userId,
        action: 'SHARE_CREATED',
        entity: input.resourceType,
        entityId: input.resourceId,
        details: {
          sharingRuleId: sharingRule.id,
          sharedWithUserId: input.sharedWithUserId ?? null,
          sharedWithTeamId: input.sharedWithTeamId ?? null,
          accessLevel: input.accessLevel,
        },
      })

      return sharingRule
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Sharing rule already exists')
      }
      throw error
    }
  }

  async unshare(tenantId: string, userId: string, id: string): Promise<boolean> {
    const rule = await this.prisma.sharingRule.findFirst({
      where: { id, tenantId, deletedAt: null },
    })

    if (!rule) {
      throw new NotFoundException('Sharing rule not found')
    }

    // Check permission: owner of the rule (sharedBy), record owner, or ADMIN
    const isAdmin = await this.checkAdmin(userId, tenantId)
    if (!isAdmin && rule.sharedBy !== userId) {
      const canManage = await this.canManageSharing(
        tenantId,
        userId,
        rule.resourceType,
        rule.resourceId,
      )
      if (!canManage) {
        throw new ForbiddenException(
          'Only the share creator, record owner, or ADMIN can revoke sharing',
        )
      }
    }

    await this.prisma.sharingRule.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    await this.auditService.log({
      tenantId,
      userId,
      action: 'SHARE_REVOKED',
      entity: rule.resourceType,
      entityId: rule.resourceId,
      details: { sharingRuleId: id },
    })

    return true
  }

  async updateAccess(
    tenantId: string,
    userId: string,
    id: string,
    input: UpdateSharingInput,
  ): Promise<SharingRule> {
    const rule = await this.prisma.sharingRule.findFirst({
      where: { id, tenantId, deletedAt: null },
    })

    if (!rule) {
      throw new NotFoundException('Sharing rule not found')
    }

    // Check permission: owner of the rule (sharedBy), record owner, or ADMIN
    const isAdmin = await this.checkAdmin(userId, tenantId)
    if (!isAdmin && rule.sharedBy !== userId) {
      const canManage = await this.canManageSharing(
        tenantId,
        userId,
        rule.resourceType,
        rule.resourceId,
      )
      if (!canManage) {
        throw new ForbiddenException(
          'Only the share creator, record owner, or ADMIN can update sharing',
        )
      }
    }

    const updated = await this.prisma.sharingRule.update({
      where: { id },
      data: { accessLevel: input.accessLevel },
    })

    await this.auditService.log({
      tenantId,
      userId,
      action: 'SHARE_UPDATED',
      entity: rule.resourceType,
      entityId: rule.resourceId,
      details: {
        sharingRuleId: id,
        previousAccessLevel: rule.accessLevel,
        newAccessLevel: input.accessLevel,
      },
    })

    return updated
  }

  async getSharingRules(
    tenantId: string,
    userId: string,
    resourceType: ResourceType,
    resourceId: string,
  ): Promise<SharingRuleListEntry[]> {
    // Only record owner can view sharing rules (or ADMIN)
    const canManage = await this.canManageSharing(tenantId, userId, resourceType, resourceId)
    if (!canManage) {
      throw new ForbiddenException('Only the record owner can view sharing rules')
    }

    return this.prisma.sharingRule.findMany({
      where: { tenantId, resourceType, resourceId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    })
  }

  async getSharedWithMe(
    tenantId: string,
    userId: string,
    resourceType?: ResourceType,
  ): Promise<SharingRuleListEntry[]> {
    // Get user's teamId and verify tenant membership
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { teamId: true, tenantId: true },
    })
    if (!user || user.tenantId !== tenantId) return []

    const where: Record<string, unknown> = {
      tenantId,
      deletedAt: null,
      OR: [
        { sharedWithUserId: userId },
        ...(user?.teamId ? [{ sharedWithTeamId: user.teamId }] : []),
      ],
    }

    if (resourceType) {
      where.resourceType = resourceType
    }

    return this.prisma.sharingRule.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    })
  }

  private async checkAdmin(userId: string, tenantId: string): Promise<boolean> {
    const userRoles = await this.prisma.userRole.findMany({
      where: {
        userId,
        role: { tenantId, deletedAt: null },
      },
      include: { role: { select: { name: true } } },
    })
    return userRoles.some((ur) => ur.role.name === 'ADMIN')
  }
}
