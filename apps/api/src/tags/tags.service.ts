import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'

import { AuditService } from '../audit/audit.service'
import { PrismaService } from '../prisma/prisma.service'
import type { Tag } from '@prisma/client'

export type CreateTagInput = {
  name: string
  color?: string
}

export type UpdateTagInput = {
  name?: string
  color?: string
}

const MAX_TAG_NAME_LENGTH = 50
const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/

function normalizeTagName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new BadRequestException('Tag name is required')
  }
  if (trimmed.length > MAX_TAG_NAME_LENGTH) {
    throw new BadRequestException(`Tag name must be at most ${MAX_TAG_NAME_LENGTH} characters`)
  }
  return trimmed
}

function normalizeColor(color?: string): string {
  if (!color) {
    return '#3B82F6'
  }
  if (!HEX_COLOR_REGEX.test(color)) {
    throw new BadRequestException('Color must be a valid hex color (e.g. #3B82F6)')
  }
  return color
}

@Injectable()
export class TagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(tenantId: string, name: string, color?: string): Promise<Tag> {
    const normalizedName = normalizeTagName(name)
    const normalizedColor = normalizeColor(color)

    try {
      const tag = await this.prisma.tag.create({
        data: {
          tenantId,
          name: normalizedName,
          color: normalizedColor,
        },
      })

      await this.auditService.log({
        tenantId,
        userId: 'system',
        action: 'CREATE',
        entity: 'Tag',
        entityId: tag.id,
        details: { name: normalizedName, color: normalizedColor },
      })

      return tag
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Tag name already exists for this tenant')
      }
      throw error
    }
  }

  async update(tenantId: string, tagId: string, input: UpdateTagInput): Promise<Tag> {
    const tag = await this.prisma.tag.findFirst({
      where: { id: tagId, tenantId },
    })

    if (!tag) {
      throw new NotFoundException('Tag not found')
    }

    const data: Record<string, string> = {}
    if (input.name !== undefined) {
      data.name = normalizeTagName(input.name)
    }
    if (input.color !== undefined) {
      data.color = normalizeColor(input.color)
    }

    try {
      const updated = await this.prisma.tag.update({
        where: { id: tagId },
        data,
      })

      await this.auditService.log({
        tenantId,
        userId: 'system',
        action: 'UPDATE',
        entity: 'Tag',
        entityId: tagId,
        details: input,
      })

      return updated
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Tag name already exists for this tenant')
      }
      throw error
    }
  }

  async findAll(tenantId: string): Promise<Tag[]> {
    return this.prisma.tag.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    })
  }

  async delete(
    tenantId: string,
    tagId: string,
  ): Promise<{ success: boolean; affectedContacts: number }> {
    // Verify tag exists and belongs to tenant
    const tag = await this.prisma.tag.findFirst({
      where: { id: tagId, tenantId },
    })

    if (!tag) {
      throw new NotFoundException('Tag not found')
    }

    // Count affected contacts for warning
    const affectedContacts = await this.prisma.contactTag.count({
      where: { tagId },
    })

    // Cascade delete: ContactTag entries are removed via Prisma cascade
    await this.prisma.tag.delete({
      where: { id: tagId },
    })

    await this.auditService.log({
      tenantId,
      userId: 'system',
      action: 'DELETE',
      entity: 'Tag',
      entityId: tagId,
      details: { affectedContacts },
    })

    return { success: true, affectedContacts }
  }

  async addTagToContact(tenantId: string, contactId: string, tagId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Verify tag exists and belongs to tenant
      const tag = await tx.tag.findFirst({
        where: { id: tagId, tenantId },
      })

      if (!tag) {
        throw new NotFoundException('Tag not found')
      }

      // Verify contact exists and belongs to tenant
      const contact = await tx.contact.findFirst({
        where: { id: contactId, tenantId, deletedAt: null },
      })

      if (!contact) {
        throw new NotFoundException('Contact not found')
      }

      try {
        await tx.contactTag.create({
          data: { contactId, tagId },
        })
      } catch (error) {
        if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
          // Tag already assigned to contact — this is idempotent, swallow
          return
        }
        throw error
      }
    })
  }

  async removeTagFromContact(tenantId: string, contactId: string, tagId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Verify tag exists and belongs to tenant
      const tag = await tx.tag.findFirst({
        where: { id: tagId, tenantId },
      })

      if (!tag) {
        throw new NotFoundException('Tag not found')
      }

      // Verify contact exists and belongs to tenant
      const contact = await tx.contact.findFirst({
        where: { id: contactId, tenantId, deletedAt: null },
      })

      if (!contact) {
        throw new NotFoundException('Contact not found')
      }

      try {
        await tx.contactTag.delete({
          where: { contactId_tagId: { contactId, tagId } },
        })
      } catch (error) {
        if (error instanceof PrismaClientKnownRequestError && error.code === 'P2025') {
          throw new NotFoundException('Tag is not assigned to this contact')
        }
        throw error
      }
    })
  }

  async findByContact(tenantId: string, contactId: string): Promise<Tag[]> {
    // Verify contact exists and belongs to tenant
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, tenantId, deletedAt: null },
    })

    if (!contact) {
      throw new NotFoundException('Contact not found')
    }

    const contactTags = await this.prisma.contactTag.findMany({
      where: { contactId },
      include: { tag: true },
    })

    return contactTags.map((ct) => ct.tag)
  }
}
