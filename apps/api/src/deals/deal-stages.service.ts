import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/explicit-module-boundary-types */

import { Prisma } from '@prisma/client'

import { PrismaService } from '../prisma/prisma.service'

export type CreateDealStageInput = {
  name: string
  color?: string
  probability?: number
  isWon?: boolean
  isLost?: boolean
}

export type UpdateDealStageInput = {
  name?: string
  color?: string
  probability?: number
  isWon?: boolean
  isLost?: boolean
}

@Injectable()
export class DealStageService {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(tenantId: string) {
    return this.prisma.dealStage.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { order: 'asc' },
    })
  }

  async create(tenantId: string, input: CreateDealStageInput) {
    const name = input.name.trim()
    if (!name) {
      throw new BadRequestException('Stage name is required')
    }

    // Find max order for this tenant
    const lastStage = await this.prisma.dealStage.findFirst({
      where: { tenantId, deletedAt: null },
      orderBy: { order: 'desc' },
      select: { order: true },
    })

    const newOrder = (lastStage?.order ?? -1) + 1

    try {
      return await this.prisma.dealStage.create({
        data: {
          tenantId,
          name,
          order: newOrder,
          color: input.color?.trim() || '#3B82F6',
          probability: input.probability ?? 0,
          isWon: input.isWon ?? false,
          isLost: input.isLost ?? false,
          createdBy: 'system',
          updatedBy: 'system',
        },
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('Stage name already exists')
      }
      throw error
    }
  }

  async update(tenantId: string, id: string, input: UpdateDealStageInput) {
    const stage = await this.prisma.dealStage.findFirst({
      where: { id, tenantId, deletedAt: null },
    })
    if (!stage) {
      throw new NotFoundException('Stage not found')
    }

    const data: Record<string, unknown> = { updatedBy: 'system' }
    if (input.name !== undefined) {
      const name = input.name.trim()
      if (!name) throw new BadRequestException('Stage name is required')
      data.name = name
    }
    if (input.color !== undefined) {
      data.color = input.color.trim()
    }
    if (input.probability !== undefined) {
      data.probability = input.probability
    }
    if (input.isWon !== undefined) {
      data.isWon = input.isWon
    }
    if (input.isLost !== undefined) {
      data.isLost = input.isLost
    }

    try {
      await this.prisma.dealStage.updateMany({
        where: { id, tenantId },
        data,
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('Stage name already exists')
      }
      throw error
    }

    const updated = await this.prisma.dealStage.findFirst({
      where: { id, tenantId, deletedAt: null },
    })
    if (!updated) {
      throw new NotFoundException('Stage not found')
    }
    return updated
  }

  async reorder(tenantId: string, orderedStageIds: string[]) {
    if (!orderedStageIds || orderedStageIds.length === 0) {
      throw new BadRequestException('At least one stage ID is required')
    }

    // Validate no duplicates
    if (new Set(orderedStageIds).size !== orderedStageIds.length) {
      throw new BadRequestException('Duplicate stage IDs are not allowed')
    }

    // Fetch all active stages for this tenant
    const stages = await this.prisma.dealStage.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true },
    })

    const validIds = new Set(stages.map((s: { id: string }) => s.id))

    // Validate all IDs belong to tenant and match the active set
    if (orderedStageIds.length !== stages.length) {
      throw new BadRequestException('Stage IDs must match exactly the set of active stages')
    }

    for (const stageId of orderedStageIds) {
      if (!validIds.has(stageId)) {
        throw new BadRequestException(`Stage ${stageId} not found in this tenant`)
      }
    }

    // Update all orders in a single transaction
    await this.prisma.$transaction(
      orderedStageIds.map((stageId, index) =>
        this.prisma.dealStage.updateMany({
          where: { id: stageId, tenantId },
          data: { order: index, updatedBy: 'system' },
        }),
      ),
    )

    return this.findMany(tenantId)
  }

  async delete(tenantId: string, id: string) {
    const stage = await this.prisma.dealStage.findFirst({
      where: { id, tenantId, deletedAt: null },
    })
    if (!stage) {
      throw new NotFoundException('Stage not found')
    }

    // Block deletion if active deals reference this stage
    const activeDealCount = await this.prisma.deal.count({
      where: { stageId: id, tenantId, deletedAt: null },
    })
    if (activeDealCount > 0) {
      throw new ConflictException(
        `Cannot delete stage "${stage.name}": ${activeDealCount} active deal(s) reference it`,
      )
    }

    await this.prisma.dealStage.updateMany({
      where: { id, tenantId },
      data: { deletedAt: new Date(), updatedBy: 'system' },
    })

    return this.prisma.dealStage.findFirst({
      where: { id, tenantId },
    })
  }
}
