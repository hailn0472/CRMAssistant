import { BadRequestException, NotFoundException } from '@nestjs/common'

import { TaskTemplatesService } from '../task-templates.service'
import type { PrismaService } from '../../prisma/prisma.service'
import type { AuditService } from '../../audit/audit.service'

type TemplateDelegate = {
  findFirst: jest.Mock
  findMany: jest.Mock
  count: jest.Mock
  create: jest.Mock
  updateMany: jest.Mock
}

type MockPrisma = {
  taskTemplate: TemplateDelegate
}

const TENANT = 'tenant-1'
const USER = 'user-1'

function makeTemplate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'template-1',
    tenantId: TENANT,
    name: 'Discovery call',
    title: 'Discovery call follow-up',
    description: 'Call the lead',
    defaultPriority: 'MEDIUM',
    defaultDueInDays: 3,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    createdBy: 'system',
    updatedBy: 'system',
    deletedAt: null,
    ...overrides,
  }
}

function makeService(prisma: MockPrisma): {
  service: TaskTemplatesService
  audit: { log: jest.Mock }
} {
  const audit = { log: jest.fn() }
  const service = new TaskTemplatesService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  )
  return { service, audit }
}

describe('TaskTemplatesService', () => {
  let prisma: MockPrisma

  beforeEach(() => {
    jest.clearAllMocks()
    prisma = {
      taskTemplate: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
    }
  })

  describe('findMany()', () => {
    it('returns a paginated connection scoped to the tenant', async () => {
      const { service } = makeService(prisma)
      prisma.taskTemplate.findMany.mockResolvedValue([makeTemplate()])
      prisma.taskTemplate.count.mockResolvedValue(1)

      const result = await service.findMany(TENANT)

      expect(result.items).toHaveLength(1)
      expect(result.total).toBe(1)
      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(20)
      expect(prisma.taskTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT, deletedAt: null },
        }),
      )
    })

    it('returns an empty connection when no templates exist', async () => {
      const { service } = makeService(prisma)
      prisma.taskTemplate.findMany.mockResolvedValue([])
      prisma.taskTemplate.count.mockResolvedValue(0)

      const result = await service.findMany(TENANT)

      expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 20 })
    })

    it('takes no userId on reads (tenant-global catalogue, AC 37)', async () => {
      const { service } = makeService(prisma)
      prisma.taskTemplate.findMany.mockResolvedValue([])
      prisma.taskTemplate.count.mockResolvedValue(0)

      // @ts-expect-error — deliberate: findMany must not accept a userId argument
      await service.findMany(TENANT, USER)
    })
  })

  describe('findOneForTenant()', () => {
    it('returns the template when found', async () => {
      const { service } = makeService(prisma)
      prisma.taskTemplate.findFirst.mockResolvedValue(makeTemplate())

      const result = await service.findOneForTenant(TENANT, 'template-1')

      expect(result.id).toBe('template-1')
    })

    it('throws NotFoundException for a missing template', async () => {
      const { service } = makeService(prisma)
      prisma.taskTemplate.findFirst.mockResolvedValue(null)

      await expect(service.findOneForTenant(TENANT, 'missing')).rejects.toThrow(
        'Task template not found',
      )
    })
  })

  describe('create()', () => {
    it('creates a template with the audit columns set to the acting user', async () => {
      const { service, audit } = makeService(prisma)
      prisma.taskTemplate.findFirst.mockResolvedValue(null)
      prisma.taskTemplate.create.mockResolvedValue(makeTemplate())

      await service.create(TENANT, USER, {
        name: 'Discovery call',
        title: 'Discovery call follow-up',
      })

      expect(prisma.taskTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: TENANT,
            name: 'Discovery call',
            createdBy: USER,
            updatedBy: USER,
          }),
        }),
      )
      expect(audit.log).toHaveBeenCalledWith({
        tenantId: TENANT,
        userId: USER,
        action: 'CREATE',
        entity: 'TASK_TEMPLATE',
        entityId: 'template-1',
        details: { mutationName: 'CREATE' },
      })
    })

    it('rejects a duplicate name case-insensitively with ConflictException', async () => {
      const { service } = makeService(prisma)
      prisma.taskTemplate.findFirst.mockResolvedValue(makeTemplate())

      await expect(
        service.create(TENANT, USER, { name: 'DISCOVERY CALL', title: 'Follow-up' }),
      ).rejects.toThrow('Task template name already exists')
      expect(prisma.taskTemplate.create).not.toHaveBeenCalled()
    })

    it('allows the same name in a different tenant', async () => {
      const { service } = makeService(prisma)
      prisma.taskTemplate.findFirst.mockResolvedValue(null)
      prisma.taskTemplate.create.mockResolvedValue(makeTemplate())

      await service.create('tenant-2', USER, { name: 'Discovery call', title: 'Follow-up' })

      expect(prisma.taskTemplate.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 'tenant-2' }),
        }),
      )
      expect(prisma.taskTemplate.create).toHaveBeenCalled()
    })
  })

  describe('input validation (normalizers)', () => {
    it('rejects an empty template name (AC 38)', async () => {
      const { service } = makeService(prisma)
      prisma.taskTemplate.findFirst.mockResolvedValue(null)

      await expect(
        service.create(TENANT, USER, { name: '   ', title: 'Follow-up' }),
      ).rejects.toThrow('Task template name is required')
      expect(prisma.taskTemplate.create).not.toHaveBeenCalled()
    })

    it('rejects a template name longer than 200 characters', async () => {
      const { service } = makeService(prisma)
      prisma.taskTemplate.findFirst.mockResolvedValue(null)

      await expect(
        service.create(TENANT, USER, { name: 'x'.repeat(201), title: 'Follow-up' }),
      ).rejects.toThrow('Task template name must be at most 200 characters')
    })

    it('rejects an empty template title', async () => {
      const { service } = makeService(prisma)
      prisma.taskTemplate.findFirst.mockResolvedValue(null)

      await expect(
        service.create(TENANT, USER, { name: 'Discovery call', title: '   ' }),
      ).rejects.toThrow('Task template title is required')
    })

    it('rejects a template title longer than 200 characters', async () => {
      const { service } = makeService(prisma)
      prisma.taskTemplate.findFirst.mockResolvedValue(null)

      await expect(
        service.create(TENANT, USER, { name: 'Discovery call', title: 'y'.repeat(201) }),
      ).rejects.toThrow('Task template title must be at most 200 characters')
    })

    it('rejects a description longer than 5000 characters', async () => {
      const { service } = makeService(prisma)
      prisma.taskTemplate.findFirst.mockResolvedValue(null)

      await expect(
        service.create(TENANT, USER, {
          name: 'Discovery call',
          title: 'Follow-up',
          description: 'z'.repeat(5001),
        }),
      ).rejects.toThrow('Description must be at most 5000 characters')
    })

    it('stores null for a whitespace-only description', async () => {
      const { service } = makeService(prisma)
      prisma.taskTemplate.findFirst.mockResolvedValue(null)
      prisma.taskTemplate.create.mockResolvedValue(makeTemplate())

      await service.create(TENANT, USER, {
        name: 'Discovery call',
        title: 'Follow-up',
        description: '   ',
      })

      expect(prisma.taskTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ description: null }) }),
      )
    })

    it('accepts an explicit valid defaultPriority', async () => {
      const { service } = makeService(prisma)
      prisma.taskTemplate.findFirst.mockResolvedValue(null)
      prisma.taskTemplate.create.mockResolvedValue(makeTemplate())

      await service.create(TENANT, USER, {
        name: 'Discovery call',
        title: 'Follow-up',
        defaultPriority: 'URGENT',
      })

      expect(prisma.taskTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ defaultPriority: 'URGENT' }) }),
      )
    })
  })

  describe('update()', () => {
    it('updates editable fields and excludes the row under edit from the duplicate check', async () => {
      const { service, audit } = makeService(prisma)
      prisma.taskTemplate.findFirst
        .mockResolvedValueOnce(makeTemplate()) // findOneForTenant (pre-check)
        .mockResolvedValueOnce(null) // duplicate-name check — no other row
        .mockResolvedValueOnce(makeTemplate({ name: 'Renamed', defaultDueInDays: 10 })) // re-read
      prisma.taskTemplate.updateMany.mockResolvedValue({ count: 1 })

      const result = await service.update(TENANT, USER, 'template-1', {
        name: 'Renamed',
        defaultDueInDays: 10,
      })

      expect(prisma.taskTemplate.findFirst).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: expect.objectContaining({ id: { not: 'template-1' } }),
        }),
      )
      expect(prisma.taskTemplate.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'template-1', tenantId: TENANT, deletedAt: null },
          data: expect.objectContaining({ name: 'Renamed', defaultDueInDays: 10 }),
        }),
      )
      expect(result.name).toBe('Renamed')
      expect(audit.log).toHaveBeenCalledWith({
        tenantId: TENANT,
        userId: USER,
        action: 'UPDATE',
        entity: 'TASK_TEMPLATE',
        entityId: 'template-1',
        details: { mutationName: 'UPDATE' },
      })
    })

    it('allows keeping the same name on the row under edit', async () => {
      const { service } = makeService(prisma)
      prisma.taskTemplate.findFirst
        .mockResolvedValueOnce(makeTemplate()) // findOneForTenant (pre-check)
        .mockResolvedValueOnce(null) // duplicate check excludes self
        .mockResolvedValueOnce(makeTemplate({ name: 'Discovery call' })) // re-read
      prisma.taskTemplate.updateMany.mockResolvedValue({ count: 1 })

      await service.update(TENANT, USER, 'template-1', { name: 'Discovery call' })

      expect(prisma.taskTemplate.updateMany).toHaveBeenCalled()
    })

    it('rejects renaming to a case-insensitive duplicate of another row', async () => {
      const { service } = makeService(prisma)
      prisma.taskTemplate.findFirst
        .mockResolvedValueOnce(makeTemplate())
        .mockResolvedValueOnce(makeTemplate({ id: 'template-2', name: 'Discovery Call' }))

      await expect(
        service.update(TENANT, USER, 'template-1', { name: 'DISCOVERY CALL' }),
      ).rejects.toThrow('Task template name already exists')
    })

    it('throws NotFoundException for a missing template', async () => {
      const { service } = makeService(prisma)
      prisma.taskTemplate.findFirst.mockResolvedValue(null)

      await expect(service.update(TENANT, USER, 'missing', { name: 'X' })).rejects.toThrow(
        'Task template not found',
      )
    })

    it('normalises title, description and defaultPriority when provided', async () => {
      const { service } = makeService(prisma)
      prisma.taskTemplate.findFirst
        .mockResolvedValueOnce(makeTemplate()) // findOneForTenant (pre-check)
        .mockResolvedValueOnce(makeTemplate({ title: 'New title', description: 'New desc' })) // re-read
      prisma.taskTemplate.updateMany.mockResolvedValue({ count: 1 })

      await service.update(TENANT, USER, 'template-1', {
        title: '  New title  ',
        description: 'New desc',
        defaultPriority: 'HIGH',
      })

      expect(prisma.taskTemplate.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'New title',
            description: 'New desc',
            defaultPriority: 'HIGH',
            updatedBy: USER,
          }),
        }),
      )
    })

    it('clears the description when null is passed', async () => {
      const { service } = makeService(prisma)
      prisma.taskTemplate.findFirst
        .mockResolvedValueOnce(makeTemplate()) // findOneForTenant (pre-check)
        .mockResolvedValueOnce(makeTemplate()) // re-read
      prisma.taskTemplate.updateMany.mockResolvedValue({ count: 1 })

      await service.update(TENANT, USER, 'template-1', { description: null })

      expect(prisma.taskTemplate.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ description: null, updatedBy: USER }),
        }),
      )
    })

    it('throws NotFoundException when the update affects zero rows', async () => {
      const { service } = makeService(prisma)
      prisma.taskTemplate.findFirst.mockResolvedValue(makeTemplate()) // findOneForTenant (pre-check)
      prisma.taskTemplate.updateMany.mockResolvedValue({ count: 0 })

      await expect(
        service.update(TENANT, USER, 'template-1', { title: 'New title' }),
      ).rejects.toThrow('Task template not found')
    })
  })

  describe('defaultDueInDays validation (AC 39)', () => {
    it('rejects a negative value', async () => {
      const { service } = makeService(prisma)
      prisma.taskTemplate.findFirst.mockResolvedValue(null)

      await expect(
        service.create(TENANT, USER, { name: 'X', title: 'Y', defaultDueInDays: -1 }),
      ).rejects.toThrow('defaultDueInDays must be between 0 and 365')
    })

    it('rejects a value above 365', async () => {
      const { service } = makeService(prisma)
      prisma.taskTemplate.findFirst.mockResolvedValue(null)

      await expect(
        service.create(TENANT, USER, { name: 'X', title: 'Y', defaultDueInDays: 366 }),
      ).rejects.toThrow('defaultDueInDays must be between 0 and 365')
    })

    it('accepts 0 and 365 as valid bounds', async () => {
      const { service } = makeService(prisma)
      prisma.taskTemplate.findFirst.mockResolvedValue(null)
      prisma.taskTemplate.create.mockResolvedValue(makeTemplate())

      await service.create(TENANT, USER, { name: 'A', title: 'B', defaultDueInDays: 0 })
      await service.create(TENANT, USER, { name: 'C', title: 'D', defaultDueInDays: 365 })

      expect(prisma.taskTemplate.create).toHaveBeenCalledTimes(2)
    })

    it('accepts null (no due date)', async () => {
      const { service } = makeService(prisma)
      prisma.taskTemplate.findFirst.mockResolvedValue(null)
      prisma.taskTemplate.create.mockResolvedValue(makeTemplate())

      await service.create(TENANT, USER, { name: 'X', title: 'Y', defaultDueInDays: null })

      expect(prisma.taskTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ defaultDueInDays: null }) }),
      )
    })

    it('rejects an invalid defaultPriority', async () => {
      const { service } = makeService(prisma)
      prisma.taskTemplate.findFirst.mockResolvedValue(null)

      await expect(
        service.create(TENANT, USER, { name: 'X', title: 'Y', defaultPriority: 'CRITICAL' }),
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('delete()', () => {
    it('soft-deletes the template and returns true', async () => {
      const { service, audit } = makeService(prisma)
      prisma.taskTemplate.findFirst.mockResolvedValue(makeTemplate())
      prisma.taskTemplate.updateMany.mockResolvedValue({ count: 1 })

      const result = await service.delete(TENANT, USER, 'template-1')

      expect(result).toBe(true)
      expect(prisma.taskTemplate.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'template-1', tenantId: TENANT, deletedAt: null },
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      )
      expect(audit.log).toHaveBeenCalledWith({
        tenantId: TENANT,
        userId: USER,
        action: 'DELETE',
        entity: 'TASK_TEMPLATE',
        entityId: 'template-1',
        details: { mutationName: 'DELETE' },
      })
    })

    it('throws NotFoundException when the template is already deleted', async () => {
      const { service } = makeService(prisma)
      prisma.taskTemplate.findFirst.mockResolvedValue(makeTemplate())
      prisma.taskTemplate.updateMany.mockResolvedValue({ count: 0 })

      await expect(service.delete(TENANT, USER, 'template-1')).rejects.toThrow(
        'Task template not found',
      )
    })

    it('throws NotFoundException when the template is in another tenant', async () => {
      const { service } = makeService(prisma)
      prisma.taskTemplate.findFirst.mockResolvedValue(null)

      await expect(service.delete('other-tenant', USER, 'template-1')).rejects.toThrow(
        NotFoundException,
      )
    })
  })
})
