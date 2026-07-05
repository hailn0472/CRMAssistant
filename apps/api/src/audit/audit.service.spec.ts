import { AuditService } from './audit.service'
import { PrismaService } from '../prisma/prisma.service'

describe('AuditService', () => {
  let service: AuditService
  let prisma: { auditLog: { create: jest.Mock } }

  beforeEach(() => {
    prisma = { auditLog: { create: jest.fn() } }
    service = new AuditService(prisma as unknown as PrismaService)
  })

  it('creates an audit log entry with correct fields', async () => {
    prisma.auditLog.create.mockResolvedValue({ id: 'log-1' })

    await service.log({
      tenantId: 'tenant-1',
      userId: 'user-1',
      action: 'ROLE_ASSIGNED',
      entity: 'UserRole',
      entityId: 'user-1:role-1',
      details: { userId: 'user-1', roleId: 'role-1', roleName: 'ADMIN' },
    })

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        action: 'ROLE_ASSIGNED',
        entity: 'UserRole',
        entityId: 'user-1:role-1',
        details: { userId: 'user-1', roleId: 'role-1', roleName: 'ADMIN' },
      },
    })
  })

  it('handles null details', async () => {
    prisma.auditLog.create.mockResolvedValue({ id: 'log-2' })

    await service.log({
      tenantId: 'tenant-1',
      userId: 'user-1',
      action: 'ROLE_REMOVED',
      entity: 'UserRole',
      entityId: 'user-1:role-1',
    })

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        details: undefined,
      }),
    })
  })
})
