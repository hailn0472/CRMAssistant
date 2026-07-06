import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { requirePermission, registerPermissionService } from './permission-check'
import type { PrismaService } from '../../prisma/prisma.service'
import type { GraphqlContext } from '../../graphql/graphql-context'

type MockPrisma = {
  rolePermission: {
    count: jest.Mock
  }
}

function makePrisma(): MockPrisma {
  return {
    rolePermission: {
      count: jest.fn(),
    },
  }
}

function makeContext(roles: string[]): GraphqlContext {
  return {
    user: {
      sub: 'user-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      roles,
      email: 'test@test.com',
    },
  }
}

describe('requirePermission', () => {
  let prisma: MockPrisma

  beforeEach(() => {
    prisma = makePrisma()
    registerPermissionService(prisma as unknown as PrismaService)
  })

  it('throws UnauthorizedException when user is not authenticated', async () => {
    const context: GraphqlContext = {}

    await expect(requirePermission(context, 'CONTACT', 'READ')).rejects.toThrow(
      UnauthorizedException,
    )
  })

  it('bypasses for ADMIN role without DB query', async () => {
    const context = makeContext(['ADMIN'])

    await requirePermission(context, 'CONTACT', 'DELETE')

    // Should not have called count
    expect(prisma.rolePermission.count).not.toHaveBeenCalled()
  })

  it('passes when user has matching permission', async () => {
    prisma.rolePermission.count.mockResolvedValue(1)
    const context = makeContext(['SALES_REP'])

    await requirePermission(context, 'CONTACT', 'READ')

    expect(prisma.rolePermission.count).toHaveBeenCalled()
  })

  it('throws 403 when user lacks permission', async () => {
    prisma.rolePermission.count.mockResolvedValue(0)
    const context = makeContext(['SALES_REP'])

    await expect(requirePermission(context, 'CONTACT', 'DELETE')).rejects.toThrow(
      ForbiddenException,
    )
    expect(prisma.rolePermission.count).toHaveBeenCalledWith({
      where: {
        role: {
          userRoles: { some: { userId: 'user-1' } },
          deletedAt: null,
        },
        permission: { resource: 'CONTACT', action: 'DELETE' },
      },
    })
  })

  it('passes for ADMIN even when DB has no permissions', async () => {
    const context = makeContext(['ADMIN'])

    await requirePermission(context, 'SETTINGS', 'DELETE')

    // ADMIN bypass means no DB call
    expect(prisma.rolePermission.count).not.toHaveBeenCalled()
  })

  it('throws Error when permission service not initialized', async () => {
    // Reset by passing undefined
    registerPermissionService(undefined as unknown as PrismaService)

    const context = makeContext(['SALES_REP'])

    await expect(requirePermission(context, 'CONTACT', 'READ')).rejects.toThrow(
      'Permission service not initialized',
    )
  })
})
