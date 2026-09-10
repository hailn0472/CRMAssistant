import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { NotesService } from '../notes.service'

/* eslint-disable @typescript-eslint/no-explicit-any */

const note = (overrides: Record<string, unknown> = {}): any => ({
  id: 'note-1',
  tenantId: 'tenant-1',
  contactId: 'contact-1',
  userId: 'user-1',
  body: 'A note',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  createdBy: 'user-1',
  updatedBy: 'user-1',
  deletedAt: null,
  author: { id: 'user-1', firstName: 'Ada', lastName: 'Lovelace' },
  ...overrides,
})

describe('NotesService', () => {
  let service: NotesService
  let prisma: any
  let audit: any
  let activities: any

  beforeEach(() => {
    prisma = {
      note: {
        create: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
    }
    audit = { log: jest.fn().mockResolvedValue(undefined) }
    activities = {
      checkContactAccess: jest.fn().mockResolvedValue(undefined),
      logSafe: jest.fn().mockResolvedValue(undefined),
    }
    service = new NotesService(prisma, audit, activities)
  })

  describe('create', () => {
    it('normalizes, persists, audits, and logs a note activity', async () => {
      const created = note({ body: 'normalized note' })
      prisma.note.create.mockResolvedValue(created)

      await expect(
        service.create('tenant-1', 'user-1', {
          contactId: 'contact-1',
          body: '  normalized note\r\n',
        }),
      ).resolves.toEqual(created)

      expect(activities.checkContactAccess).toHaveBeenCalledWith('tenant-1', 'user-1', 'contact-1')
      expect(prisma.note.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ body: 'normalized note', createdBy: 'user-1' }),
        }),
      )
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', entity: 'NOTE', entityId: 'note-1' }),
      )
      expect(activities.logSafe).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'NOTE_ADDED',
          sourceId: 'note-1',
          title: 'normalized note',
        }),
      )
    })

    it('rejects an empty body before checking contact access', async () => {
      await expect(
        service.create('tenant-1', 'user-1', { contactId: 'contact-1', body: ' \r\n ' }),
      ).rejects.toThrow('Note body is required')
      expect(activities.checkContactAccess).not.toHaveBeenCalled()
    })

    it('propagates contact access failures', async () => {
      activities.checkContactAccess.mockRejectedValue(new ForbiddenException('No access'))
      await expect(
        service.create('tenant-1', 'user-1', { contactId: 'contact-1', body: 'valid' }),
      ).rejects.toThrow(ForbiddenException)
      expect(prisma.note.create).not.toHaveBeenCalled()
    })
  })

  describe('update', () => {
    it('updates and returns the note owned by the caller', async () => {
      const existing = note()
      const updated = note({ body: 'updated' })
      prisma.note.findFirst.mockResolvedValueOnce(existing).mockResolvedValueOnce(updated)
      prisma.note.update.mockResolvedValue({})

      await expect(
        service.update('tenant-1', 'user-1', 'note-1', { body: ' updated ' }),
      ).resolves.toEqual(updated)
      expect(prisma.note.update).toHaveBeenCalledWith({
        where: { id: 'note-1' },
        data: { body: 'updated', updatedBy: 'user-1' },
      })
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE', entityId: 'note-1' }),
      )
    })

    it('rejects a missing note', async () => {
      prisma.note.findFirst.mockResolvedValue(null)
      await expect(
        service.update('tenant-1', 'user-1', 'missing', { body: 'updated' }),
      ).rejects.toThrow(NotFoundException)
    })

    it('rejects edits by another user', async () => {
      prisma.note.findFirst.mockResolvedValue(note({ userId: 'other-user' }))
      await expect(
        service.update('tenant-1', 'user-1', 'note-1', { body: 'updated' }),
      ).rejects.toThrow('You can only edit your own notes')
      expect(prisma.note.update).not.toHaveBeenCalled()
    })

    it('rejects when the updated row cannot be reloaded', async () => {
      prisma.note.findFirst.mockResolvedValueOnce(note()).mockResolvedValueOnce(null)
      prisma.note.update.mockResolvedValue({})
      await expect(
        service.update('tenant-1', 'user-1', 'note-1', { body: 'updated' }),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('delete', () => {
    it('soft-deletes a note owned by the caller', async () => {
      prisma.note.findFirst.mockResolvedValue(note())
      prisma.note.update.mockResolvedValue({})

      await expect(service.delete('tenant-1', 'user-1', 'note-1', [])).resolves.toBe(true)
      expect(prisma.note.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'note-1' },
          data: expect.objectContaining({ updatedBy: 'user-1', deletedAt: expect.any(Date) }),
        }),
      )
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'DELETE' }))
    })

    it('allows an administrator to delete another user note', async () => {
      prisma.note.findFirst.mockResolvedValue(note({ userId: 'other-user' }))
      prisma.note.update.mockResolvedValue({})
      await expect(service.delete('tenant-1', 'user-1', 'note-1', ['ADMIN'])).resolves.toBe(true)
    })

    it('rejects a non-owner without the administrator role', async () => {
      prisma.note.findFirst.mockResolvedValue(note({ userId: 'other-user' }))
      await expect(service.delete('tenant-1', 'user-1', 'note-1', [])).rejects.toThrow(
        'You can only delete your own notes',
      )
      expect(prisma.note.update).not.toHaveBeenCalled()
    })
  })

  describe('findManyForContact', () => {
    it('clamps pagination and returns items with the total', async () => {
      const items = [note()]
      prisma.note.findMany.mockResolvedValue(items)
      prisma.note.count.mockResolvedValue(1)

      await expect(
        service.findManyForContact('tenant-1', 'user-1', 'contact-1', { page: 0, pageSize: 999 }),
      ).resolves.toEqual({
        items,
        total: 1,
        page: 1,
        pageSize: 100,
      })
      expect(prisma.note.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 100,
          where: { tenantId: 'tenant-1', contactId: 'contact-1', deletedAt: null },
        }),
      )
    })
  })

  describe('findOneForGate', () => {
    it('looks up only active notes in the tenant', async () => {
      const gate = { id: 'note-1', contactId: 'contact-1', userId: 'user-1' }
      prisma.note.findFirst.mockResolvedValue(gate)
      await expect(service.findOneForGate('tenant-1', 'note-1')).resolves.toEqual(gate)
      expect(prisma.note.findFirst).toHaveBeenCalledWith({
        where: { id: 'note-1', tenantId: 'tenant-1', deletedAt: null },
        select: { id: true, contactId: true, userId: true },
      })
    })
  })
})
