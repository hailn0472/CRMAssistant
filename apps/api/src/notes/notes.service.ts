import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'

import type { Prisma } from '@prisma/client'

import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { DealsService } from '../deals/deals.service'
import { ActivityService } from '../activities/activities.service'
import { normalizeNoteBody, assertValidNoteBody, resolveNoteParent } from './note-validation'

export type CreateNoteInput = {
  contactId?: string | null
  dealId?: string | null
  body: string
}

export type UpdateNoteInput = {
  body: string
}

export type NoteParentInput = {
  contactId?: string | null
  dealId?: string | null
}

export type NotePaginationInput = {
  page?: number
  pageSize?: number
}

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

/**
 * Every field the Pothos NoteRef / NoteAuthorRef exposes must be in this select.
 * A ref field the select omits crashes at query time, not compile time (Trap T1).
 */
export const NOTE_SELECT = {
  id: true,
  tenantId: true,
  contactId: true,
  dealId: true,
  userId: true,
  body: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  deletedAt: true,
  author: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
    },
  },
} as const

export interface NoteRecord {
  id: string
  tenantId: string
  contactId: string | null
  dealId: string | null
  userId: string
  body: string
  createdAt: Date
  updatedAt: Date
  createdBy: string
  updatedBy: string
  deletedAt: Date | null
  author: { id: string; firstName: string; lastName: string }
}

export interface NoteConnectionResult {
  items: NoteRecord[]
  total: number
  page: number
  pageSize: number
}

@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly deals: DealsService,
    private readonly activities: ActivityService,
  ) {}

  /**
   * Derive access from the parent — exactly one of the two FKs is non-null.
   * Never call resolveVisibilityFilter or resolveSharedRecordIds directly from
   * NotesService; both parent primitives already encode ownership AND sharing.
   */
  private async assertParentAccess(
    tenantId: string,
    userId: string,
    parent: { parent: 'CONTACT' | 'DEAL'; id: string },
  ): Promise<void> {
    if (parent.parent === 'DEAL') {
      await this.deals.findOne(tenantId, userId, parent.id)
      return
    }
    await this.activities.checkContactAccess(tenantId, userId, parent.id)
  }

  private async writeAudit(
    tenantId: string,
    userId: string,
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    noteId: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.log({
      tenantId,
      userId,
      action,
      entity: 'NOTE',
      entityId: noteId,
      details,
    })
  }

  async create(tenantId: string, userId: string, input: CreateNoteInput): Promise<NoteRecord> {
    const parent = resolveNoteParent({
      contactId: input.contactId,
      dealId: input.dealId,
    })
    const body = normalizeNoteBody(input.body)
    assertValidNoteBody(body)
    await this.assertParentAccess(tenantId, userId, parent)

    const data: Prisma.NoteCreateInput = {
      tenant: { connect: { id: tenantId } },
      author: { connect: { id: userId } },
      body,
      createdBy: userId,
      updatedBy: userId,
    }

    if (parent.parent === 'CONTACT') {
      data.contact = { connect: { id: parent.id } }
    } else {
      data.deal = { connect: { id: parent.id } }
    }

    const note = await this.prisma.note.create({
      data,
      select: NOTE_SELECT,
    })

    // Audit with the real row id
    await this.writeAudit(tenantId, userId, 'CREATE', note.id)

    // Contact-timeline marker (AC 24): logSafe never fails the mutation
    if (parent.parent === 'CONTACT') {
      const bodyPreview = body.substring(0, 80)
      await this.activities.logSafe({
        tenantId,
        contactId: parent.id,
        type: 'NOTE_ADDED',
        title: bodyPreview,
        description: body,
        source: 'NOTE',
        sourceId: note.id,
        dedupeKey: `NOTE:${note.id}`,
        createdBy: userId,
      })
    }
    // DEAL notes write NO Activity row (AC 25)

    return note as unknown as NoteRecord
  }

  async update(
    tenantId: string,
    userId: string,
    id: string,
    input: UpdateNoteInput,
  ): Promise<NoteRecord> {
    const body = normalizeNoteBody(input.body)
    assertValidNoteBody(body)

    const note = await this.prisma.note.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: NOTE_SELECT,
    })
    if (!note) {
      throw new NotFoundException('Note not found')
    }

    // Re-derive the parent from the loaded row, never from client input
    const parent = resolveNoteParent({
      contactId: note.contactId,
      dealId: note.dealId,
    })
    await this.assertParentAccess(tenantId, userId, parent)

    if (note.userId !== userId) {
      throw new ForbiddenException('You can only edit your own notes')
    }

    const updateResult = await this.prisma.note.updateMany({
      where: { id: note.id, tenantId, deletedAt: null },
      data: { body, updatedBy: userId },
    })

    if (updateResult.count === 0) {
      throw new NotFoundException('Note not found')
    }

    // Re-read the updated row
    const updated = await this.prisma.note.findFirst({
      where: { id: note.id, tenantId, deletedAt: null },
      select: NOTE_SELECT,
    })

    if (!updated) {
      throw new NotFoundException('Note not found')
    }

    await this.writeAudit(tenantId, userId, 'UPDATE', updated.id)

    return updated as unknown as NoteRecord
  }

  async delete(
    tenantId: string,
    userId: string,
    id: string,
    callerRoles: string[],
  ): Promise<boolean> {
    const note = await this.prisma.note.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: NOTE_SELECT,
    })
    if (!note) {
      throw new NotFoundException('Note not found')
    }

    // Re-derive parent from the loaded row
    const parent = resolveNoteParent({
      contactId: note.contactId,
      dealId: note.dealId,
    })
    await this.assertParentAccess(tenantId, userId, parent)

    if (note.userId !== userId && !callerRoles.includes('ADMIN')) {
      throw new ForbiddenException('You can only delete your own notes')
    }

    const deleteResult = await this.prisma.note.updateMany({
      where: { id: note.id, tenantId, deletedAt: null },
      data: { deletedAt: new Date(), updatedBy: userId },
    })

    if (deleteResult.count === 0) {
      throw new NotFoundException('Note not found')
    }

    await this.writeAudit(tenantId, userId, 'DELETE', note.id)

    return true
  }

  async findManyForParent(
    tenantId: string,
    userId: string,
    parentInput: NoteParentInput,
    pagination: NotePaginationInput = {},
  ): Promise<NoteConnectionResult> {
    const parent = resolveNoteParent({
      contactId: parentInput.contactId,
      dealId: parentInput.dealId,
    })
    await this.assertParentAccess(tenantId, userId, parent)

    const page = Math.max(pagination.page ?? DEFAULT_PAGE, 1)
    const pageSize = Math.min(Math.max(pagination.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)

    const where: Record<string, unknown> = {
      tenantId,
      deletedAt: null,
    }

    if (parent.parent === 'CONTACT') {
      where.contactId = parent.id
      where.dealId = null
    } else {
      where.dealId = parent.id
      where.contactId = null
    }

    const [items, total] = await Promise.all([
      this.prisma.note.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: NOTE_SELECT,
      }),
      this.prisma.note.count({
        where: {
          tenantId,
          deletedAt: null,
          ...(parent.parent === 'CONTACT'
            ? { contactId: parent.id, dealId: null }
            : { dealId: parent.id, contactId: null }),
        },
      }),
    ])

    return { items, total, page, pageSize }
  }

  /**
   * Lightweight find-for-gate — used by the GraphQL layer to learn which
   * parent resource a note belongs to without loading author or body.
   */
  async findOneForGate(
    tenantId: string,
    id: string,
  ): Promise<{ id: string; contactId: string | null; dealId: string | null } | null> {
    return this.prisma.note.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, contactId: true, dealId: true },
    })
  }
}
