import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import type { Team } from '@prisma/client'

export type CreateTeamInput = {
  name: string
  managerId?: string
}

export type UpdateTeamInput = {
  name?: string
  managerId?: string | null
}

export type TeamWithDetails = Team & {
  manager?: { id: string; firstName: string; lastName: string } | null
  _count: { members: number }
}

const MAX_NAME_LENGTH = 100

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

@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(tenantId: string, userId: string, input: CreateTeamInput): Promise<TeamWithDetails> {
    const name = normalizeName(input.name, 'Team name')

    try {
      const team = await this.prisma.team.create({
        data: {
          tenantId,
          name,
          managerId: input.managerId ?? null,
          createdBy: userId,
          updatedBy: userId,
        },
        include: {
          manager: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { members: { where: { deletedAt: null } } } },
        },
      })

      await this.auditService.log({
        tenantId,
        userId,
        action: 'TEAM_CREATED',
        entity: 'Team',
        entityId: team.id,
        details: { name: team.name },
      })

      return team
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Team name already exists in this tenant')
      }
      throw error
    }
  }

  async findMany(tenantId: string): Promise<TeamWithDetails[]> {
    return this.prisma.team.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { name: 'asc' },
      include: {
        manager: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { members: { where: { deletedAt: null } } } },
      },
    })
  }

  async findOne(
    tenantId: string,
    id: string,
  ): Promise<
    Team & {
      manager?: { id: string; firstName: string; lastName: string } | null
      members: { id: string; firstName: string; lastName: string; email: string }[]
    }
  > {
    const team = await this.prisma.team.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        manager: { select: { id: true, firstName: true, lastName: true } },
        members: {
          where: { deletedAt: null },
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    })

    if (!team) {
      throw new NotFoundException('Team not found')
    }

    return team
  }

  async update(
    tenantId: string,
    userId: string,
    id: string,
    input: UpdateTeamInput,
  ): Promise<TeamWithDetails> {
    const team = await this.prisma.team.findFirst({
      where: { id, tenantId, deletedAt: null },
    })

    if (!team) {
      throw new NotFoundException('Team not found')
    }

    const name = input.name !== undefined ? normalizeName(input.name, 'Team name') : undefined

    try {
      const updated = await this.prisma.team.update({
        where: { id },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(input.managerId !== undefined ? { managerId: input.managerId } : {}),
          updatedBy: userId,
        },
        include: {
          manager: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { members: { where: { deletedAt: null } } } },
        },
      })

      await this.auditService.log({
        tenantId,
        userId,
        action: 'TEAM_UPDATED',
        entity: 'Team',
        entityId: id,
        details: { changes: input },
      })

      return updated
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Team name already exists in this tenant')
      }
      throw error
    }
  }

  async delete(tenantId: string, userId: string, id: string): Promise<boolean> {
    const team = await this.prisma.team.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { _count: { select: { members: { where: { deletedAt: null } } } } },
    })

    if (!team) {
      throw new NotFoundException('Team not found')
    }

    if (team._count.members > 0) {
      throw new ConflictException(
        `Team has ${team._count.members} active member(s). Remove all members before deleting.`,
      )
    }

    await this.prisma.team.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: userId },
    })

    await this.auditService.log({
      tenantId,
      userId,
      action: 'TEAM_DELETED',
      entity: 'Team',
      entityId: id,
      details: { name: team.name },
    })

    return true
  }

  async setTeamMembers(
    tenantId: string,
    userId: string,
    teamId: string,
    memberIds: string[],
  ): Promise<
    Team & {
      manager?: { id: string; firstName: string; lastName: string } | null
      members: { id: string; firstName: string; lastName: string; email: string }[]
    }
  > {
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, tenantId, deletedAt: null },
    })

    if (!team) {
      throw new NotFoundException('Team not found')
    }

    // Validate all member IDs belong to this tenant
    if (memberIds.length > 0) {
      const usersInTenant = await this.prisma.user.findMany({
        where: { id: { in: memberIds }, tenantId, deletedAt: null },
        select: { id: true },
      })
      const validIds = new Set(usersInTenant.map((u) => u.id))
      const invalidIds = memberIds.filter((id) => !validIds.has(id))
      if (invalidIds.length > 0) {
        throw new BadRequestException(`Users not found in tenant: ${invalidIds.join(', ')}`)
      }
    }

    await this.prisma.$transaction(async (tx) => {
      // Verify team still exists inside transaction
      const teamCheck = await tx.team.findFirst({
        where: { id: teamId, tenantId, deletedAt: null },
      })
      if (!teamCheck) {
        throw new NotFoundException('Team not found')
      }

      // Check if any members are already in a different team (cross-team conflict)
      if (memberIds.length > 0) {
        const usersInOtherTeams = await tx.user.findMany({
          where: {
            id: { in: memberIds },
            tenantId,
            AND: [{ NOT: { teamId: null } }, { NOT: { teamId: teamId } }],
          },
          select: { id: true, teamId: true },
        })
        if (usersInOtherTeams.length > 0) {
          throw new ConflictException(
            `Users already belong to another team: ${usersInOtherTeams.map((u) => u.id).join(', ')}`,
          )
        }
      }

      // Remove current team members
      await tx.user.updateMany({
        where: { teamId: teamId, tenantId },
        data: { teamId: null },
      })

      // Assign new members
      if (memberIds.length > 0) {
        await tx.user.updateMany({
          where: { id: { in: memberIds }, tenantId },
          data: { teamId: teamId },
        })
      }
    })

    await this.auditService.log({
      tenantId,
      userId,
      action: 'TEAM_MEMBERS_SET',
      entity: 'Team',
      entityId: teamId,
      details: { memberIds },
    })

    return this.findOne(tenantId, teamId)
  }
}
