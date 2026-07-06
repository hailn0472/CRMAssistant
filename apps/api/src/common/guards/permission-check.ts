import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import type { PrismaService } from '../../prisma/prisma.service'
import type { GraphqlContext } from '../../graphql/graphql-context'

let prismaService: PrismaService | undefined

export function registerPermissionService(prisma: PrismaService): void {
  prismaService = prisma
}

function requireUser(context: GraphqlContext): {
  userId: string
  tenantId: string
  roles: string[]
  email: string
} {
  if (!context.user) {
    throw new UnauthorizedException('Authentication required')
  }
  return context.user
}

export async function requirePermission(
  context: GraphqlContext,
  resource: string,
  action: string,
): Promise<void> {
  const user = requireUser(context)

  // ADMIN bypass: admins have all permissions implicitly
  if (user.roles.includes('ADMIN')) return

  if (!prismaService) {
    throw new Error('Permission service not initialized')
  }

  const count = await prismaService.rolePermission.count({
    where: {
      role: {
        userRoles: { some: { userId: user.userId } },
        deletedAt: null,
      },
      permission: { resource, action },
    },
  })

  if (count === 0) {
    throw new ForbiddenException(`Missing required permission: ${resource}:${action}`)
  }
}
