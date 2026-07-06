import type { PrismaService } from '../../prisma/prisma.service'
import type { Prisma } from '@prisma/client'

let prismaService: PrismaService | undefined

export function registerVisibilityService(prisma: PrismaService): void {
  prismaService = prisma
}

export async function resolveVisibilityFilter(
  userId: string,
  tenantId: string,
): Promise<Prisma.ContactWhereInput['ownerId'] | undefined> {
  if (!prismaService) throw new Error('Visibility service not initialized')

  const userRoles = await prismaService.userRole.findMany({
    where: {
      userId,
      role: { tenantId, deletedAt: null },
    },
    include: { role: { select: { name: true, dataVisibility: true } } },
  })

  // ADMIN bypass
  if (userRoles.some((ur) => ur.role.name === 'ADMIN')) return undefined

  // VIEW_ALL_DATA permission bypass
  const hasViewAll = await prismaService.rolePermission.count({
    where: {
      role: { userRoles: { some: { userId } }, deletedAt: null },
      permission: { resource: 'DATA', action: 'VIEW_ALL' },
    },
  })
  if (hasViewAll > 0) return undefined

  // Most permissive visibility
  const visibilities = userRoles.map((ur) => ur.role.dataVisibility)
  if (visibilities.includes('ALL')) return undefined

  if (visibilities.includes('TEAM')) {
    const user = await prismaService.user.findUnique({
      where: { id: userId },
      select: { teamId: true },
    })
    if (user?.teamId) {
      const teamMembers = await prismaService.user.findMany({
        where: { teamId: user.teamId, deletedAt: null, tenantId },
        select: { id: true },
      })
      return { in: teamMembers.map((m) => m.id) }
    }
    // User has TEAM visibility but no team assigned → fall through to OWN
  }

  return userId // OWN
}

export async function applyVisibilityFilter(
  userId: string,
  tenantId: string,
  baseWhere: Prisma.ContactWhereInput,
): Promise<Prisma.ContactWhereInput> {
  const visibilityOwnerFilter = await resolveVisibilityFilter(userId, tenantId)
  if (visibilityOwnerFilter === undefined) return baseWhere
  return { ...baseWhere, ownerId: visibilityOwnerFilter }
}
