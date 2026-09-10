import type { PrismaService } from '../../prisma/prisma.service'
import type { ResourceType } from '@prisma/client'

let prismaService: PrismaService | undefined

export function registerSharingCheck(prisma: PrismaService): void {
  prismaService = prisma
}

/**
 * Returns array of record IDs that the user has access to via sharing rules.
 * Checks both direct user shares and team-based shares.
 * Returns empty array if no shared records found.
 */
export async function resolveSharedRecordIds(
  userId: string,
  tenantId: string,
  resourceType: ResourceType,
): Promise<string[]> {
  if (!prismaService) throw new Error('Sharing check service not initialized')

  // Get user's teamId
  const user = await prismaService.user.findUnique({
    where: { id: userId },
    select: { teamId: true, tenantId: true },
  })
  if (!user || user.tenantId !== tenantId) return []

  // Find sharing rules where:
  // 1. Shared directly with the user, OR
  // 2. Shared with the user's team
  const sharingRules = await prismaService.sharingRule.findMany({
    where: {
      tenantId,
      resourceType,
      deletedAt: null,
      OR: [
        { sharedWithUserId: userId },
        ...(user.teamId ? [{ sharedWithTeamId: user.teamId }] : []),
      ],
    },
    select: { resourceId: true },
  })

  return sharingRules.map((rule) => rule.resourceId)
}
