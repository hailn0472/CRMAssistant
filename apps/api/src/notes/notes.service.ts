import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { ActivityService } from '../activities/activities.service'
import { assertValidNoteBody, normalizeNoteBody } from './note-validation'

export type CreateNoteInput = { contactId: string; body: string }
export type UpdateNoteInput = { body: string }
export type NotePaginationInput = { page?: number; pageSize?: number }

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

export const NOTE_SELECT = {
  id: true,
  tenantId: true,
  contactId: true,
  userId: true,
  body: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  deletedAt: true,
  author: { select: { id: true, firstName: true, lastName: true } },
} as const

export type NoteRecord = {
  id: string
  tenantId: string
  contactId: string
  userId: string
  body: string
  createdAt: Date
  updatedAt: Date
  createdBy: string
  updatedBy: string
  deletedAt: Date | null
  author: { id: string; firstName: string; lastName: string }
}

@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly activities: ActivityService,
  ) {}

  private async assertContactAccess(
    tenantId: string,
    userId: string,
    contactId: string,
  ): Promise<void> {
    await this.activities.checkContactAccess(tenantId, userId, contactId)
  }

  async create(tenantId: string, userId: string, input: CreateNoteInput): Promise<NoteRecord> {
    const body = normalizeNoteBody(input.body)
    assertValidNoteBody(body)
    await this.assertContactAccess(tenantId, userId, input.contactId)
    const note = await this.prisma.note.create({
      data: {
        tenantId,
        contactId: input.contactId,
        userId,
        body,
        createdBy: userId,
        updatedBy: userId,
      },
      select: NOTE_SELECT,
    })
    await this.audit.log({ tenantId, userId, action: 'CREATE', entity: 'NOTE', entityId: note.id })
    await this.activities.logSafe({
      tenantId,
      contactId: input.contactId,
      type: 'NOTE_ADDED',
      title: body.substring(0, 80),
      description: body,
      source: 'NOTE',
      sourceId: note.id,
      dedupeKey: `NOTE:${note.id}`,
      createdBy: userId,
    })
    return note
  }

  async update(
    tenantId: string,
    userId: string,
    id: string,
    input: UpdateNoteInput,
  ): Promise<NoteRecord> {
    const note = await this.findOneForGate(tenantId, id)
    if (!note) throw new NotFoundException('Note not found')
    await this.assertContactAccess(tenantId, userId, note.contactId)
    if (note.userId !== userId) throw new ForbiddenException('You can only edit your own notes')
    const body = normalizeNoteBody(input.body)
    assertValidNoteBody(body)
    await this.prisma.note.update({ where: { id }, data: { body, updatedBy: userId } })
    const updated = await this.prisma.note.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: NOTE_SELECT,
    })
    if (!updated) throw new NotFoundException('Note not found')
    await this.audit.log({ tenantId, userId, action: 'UPDATE', entity: 'NOTE', entityId: id })
    return updated
  }

  async delete(tenantId: string, userId: string, id: string, roles: string[]): Promise<boolean> {
    const note = await this.findOneForGate(tenantId, id)
    if (!note) throw new NotFoundException('Note not found')
    await this.assertContactAccess(tenantId, userId, note.contactId)
    if (note.userId !== userId && !roles.includes('ADMIN'))
      throw new ForbiddenException('You can only delete your own notes')
    await this.prisma.note.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: userId },
    })
    await this.audit.log({ tenantId, userId, action: 'DELETE', entity: 'NOTE', entityId: id })
    return true
  }

  async findManyForContact(
    tenantId: string,
    userId: string,
    contactId: string,
    pagination: NotePaginationInput = {},
  ): Promise<{ items: NoteRecord[]; total: number; page: number; pageSize: number }> {
    await this.assertContactAccess(tenantId, userId, contactId)
    const page = Math.max(pagination.page ?? 1, 1)
    const pageSize = Math.min(Math.max(pagination.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)
    const where = { tenantId, contactId, deletedAt: null }
    const [items, total] = await Promise.all([
      this.prisma.note.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: NOTE_SELECT,
      }),
      this.prisma.note.count({ where }),
    ])
    return { items, total, page, pageSize }
  }

  async findOneForGate(
    tenantId: string,
    id: string,
  ): Promise<{ id: string; contactId: string; userId: string } | null> {
    return this.prisma.note.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, contactId: true, userId: true },
    })
  }
}
