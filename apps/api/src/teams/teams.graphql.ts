import { ForbiddenException, UnauthorizedException } from '@nestjs/common'

import { builder } from '../graphql/schema.builder'
import type { TeamsService } from './teams.service'
import type { GraphqlContext } from '../graphql/graphql-context'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

const TeamMemberRef = builder.objectRef<{
  id: string
  firstName: string
  lastName: string
  email: string
}>('TeamMember')

TeamMemberRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    firstName: t.exposeString('firstName'),
    lastName: t.exposeString('lastName'),
    email: t.exposeString('email'),
  }),
})

const UserRef_forTeam = builder.objectRef<{
  id: string
  firstName: string
  lastName: string
}>('TeamManager')

UserRef_forTeam.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    firstName: t.exposeString('firstName'),
    lastName: t.exposeString('lastName'),
  }),
})

const TeamRef = builder.objectRef<Awaited<ReturnType<TeamsService['findMany']>>[number]>('Team')

TeamRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    manager: t.field({
      type: UserRef_forTeam,
      nullable: true,
      resolve: (team) => team.manager ?? null,
    }),
    managerId: t.exposeString('managerId', { nullable: true }),
    memberCount: t.int({ resolve: (team) => team._count.members }),
    createdAt: t.string({ resolve: (team) => team.createdAt.toISOString() }),
  }),
})

const TeamDetailRef = builder.objectRef<Awaited<ReturnType<TeamsService['findOne']>>>('TeamDetail')

TeamDetailRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    manager: t.field({
      type: UserRef_forTeam,
      nullable: true,
      resolve: (team) => team.manager ?? null,
    }),
    managerId: t.exposeString('managerId', { nullable: true }),
    members: t.field({ type: [TeamMemberRef], resolve: (team) => team.members }),
    createdAt: t.string({ resolve: (team) => team.createdAt.toISOString() }),
  }),
})

let teamsService: TeamsService | undefined

function getTeamsService(): TeamsService {
  if (!teamsService) {
    throw new Error('TeamsService is not initialized')
  }
  return teamsService
}

function requireUser(context: GraphqlContext): JwtPayload {
  if (!context.user) {
    throw new UnauthorizedException('Authentication required')
  }
  return context.user
}

function requireAdmin(context: GraphqlContext): JwtPayload {
  const user = requireUser(context)
  if (!user.roles || !user.roles.includes('ADMIN')) {
    throw new ForbiddenException('Only admins can perform this action')
  }
  return user
}

builder.queryFields((t) => ({
  team: t.field({
    type: TeamDetailRef,
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      return getTeamsService().findOne(user.tenantId, String(args.id))
    },
  }),
  teams: t.field({
    type: [TeamRef],
    resolve: async (_parent, _args, context) => {
      const user = requireUser(context)
      return getTeamsService().findMany(user.tenantId)
    },
  }),
}))

builder.mutationFields((t) => ({
  createTeam: t.field({
    type: TeamRef,
    args: {
      name: t.arg.string({ required: true }),
      managerId: t.arg.string(),
    },
    resolve: async (_parent, args, context) => {
      requireAdmin(context)
      const user = requireUser(context)
      return getTeamsService().create(user.tenantId, user.userId, {
        name: args.name,
        managerId: args.managerId ?? undefined,
      })
    },
  }),
  updateTeam: t.field({
    type: TeamRef,
    args: {
      id: t.arg.id({ required: true }),
      name: t.arg.string(),
      managerId: t.arg.string(),
    },
    resolve: async (_parent, args, context) => {
      requireAdmin(context)
      const user = requireUser(context)
      return getTeamsService().update(user.tenantId, user.userId, String(args.id), {
        name: args.name ?? undefined,
        managerId: args.managerId !== undefined ? args.managerId ?? null : undefined,
      })
    },
  }),
  deleteTeam: t.boolean({
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      requireAdmin(context)
      const user = requireUser(context)
      return getTeamsService().delete(user.tenantId, user.userId, String(args.id))
    },
  }),
  setTeamMembers: t.field({
    type: TeamDetailRef,
    args: {
      teamId: t.arg.id({ required: true }),
      memberIds: t.arg({ type: ['ID'], required: true }),
    },
    resolve: async (_parent, args, context) => {
      requireAdmin(context)
      const user = requireUser(context)
      return getTeamsService().setTeamMembers(
        user.tenantId,
        user.userId,
        String(args.teamId),
        args.memberIds.map(String),
      )
    },
  }),
}))

export function registerTeamsGraphql(service: TeamsService): void {
  teamsService = service
}
