import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'

import { AuditService } from '../audit/audit.service'
import { PrismaService } from '../prisma/prisma.service'
import type { Prisma, SavedSegment } from '@prisma/client'

export type CreateSegmentInput = {
  name: string
  filters: Record<string, unknown>
}

export type UpdateSegmentInput = {
  name?: string
  filters?: Record<string, unknown>
}

const MAX_SEGMENT_NAME_LENGTH = 100

function normalizeSegmentName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new BadRequestException('Segment name is required')
  }
  if (trimmed.length > MAX_SEGMENT_NAME_LENGTH) {
    throw new BadRequestException(
      `Segment name must be at most ${MAX_SEGMENT_NAME_LENGTH} characters`,
    )
  }
  return trimmed
}

@Injectable()
export class SegmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(tenantId: string, userId: string, input: CreateSegmentInput): Promise<SavedSegment> {
    const name = normalizeSegmentName(input.name)

    try {
      const segment = await this.prisma.savedSegment.create({
        data: {
          tenantId,
          name,
          filters: (input.filters ?? {}) as Prisma.InputJsonValue,
          createdBy: userId,
        },
      })

      await this.auditService.log({
        tenantId,
        userId,
        action: 'CREATE',
        entity: 'SavedSegment',
        entityId: segment.id,
        details: { name, filters: input.filters },
      })

      return segment
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Segment name already exists for this tenant')
      }
      throw error
    }
  }

  async findAll(tenantId: string): Promise<SavedSegment[]> {
    return this.prisma.savedSegment.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    })
  }

  async update(
    tenantId: string,
    segmentId: string,
    input: UpdateSegmentInput,
  ): Promise<SavedSegment> {
    const segment = await this.prisma.savedSegment.findFirst({
      where: { id: segmentId, tenantId, deletedAt: null },
    })

    if (!segment) {
      throw new NotFoundException('Saved segment not found')
    }

    const data: Record<string, unknown> = {}
    if (input.name !== undefined) {
      data.name = normalizeSegmentName(input.name)
    }
    if (input.filters !== undefined) {
      data.filters = input.filters
    }

    try {
      const updated = await this.prisma.savedSegment.update({
        where: { id: segmentId },
        data,
      })

      await this.auditService.log({
        tenantId,
        userId: 'system',
        action: 'UPDATE',
        entity: 'SavedSegment',
        entityId: segmentId,
        details: input,
      })

      return updated
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Segment name already exists for this tenant')
      }
      throw error
    }
  }

  async delete(tenantId: string, segmentId: string): Promise<boolean> {
    const segment = await this.prisma.savedSegment.findFirst({
      where: { id: segmentId, tenantId, deletedAt: null },
    })

    if (!segment) {
      throw new NotFoundException('Saved segment not found')
    }

    await this.prisma.savedSegment.update({
      where: { id: segmentId },
      data: { deletedAt: new Date() },
    })

    await this.auditService.log({
      tenantId,
      userId: 'system',
      action: 'DELETE',
      entity: 'SavedSegment',
      entityId: segmentId,
    })

    return true
  }
}
