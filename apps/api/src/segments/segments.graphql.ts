import { BadRequestException, UnauthorizedException } from '@nestjs/common'

import { builder } from '../graphql/schema.builder'
import type { SegmentsService } from './segments.service'
import type { GraphqlContext } from '../graphql/graphql-context'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

type SavedSegmentShape = {
  id: string
  name: string
  filters: string // JSON-serialized string
  createdBy: string
  createdAt: string
  updatedAt: string
}

const SavedSegmentRef = builder.objectRef<SavedSegmentShape>('SavedSegment')

SavedSegmentRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    filters: t.string({
      resolve: (segment) => segment.filters,
    }),
    createdBy: t.exposeString('createdBy'),
    createdAt: t.exposeString('createdAt'),
    updatedAt: t.exposeString('updatedAt'),
  }),
})

const CreateSegmentInputRef = builder.inputType('CreateSegmentInput', {
  fields: (t) => ({
    name: t.string({ required: true }),
    filters: t.string({ required: true }), // JSON-serialized string
  }),
})

const UpdateSegmentInputRef = builder.inputType('UpdateSegmentInput', {
  fields: (t) => ({
    name: t.string(),
    filters: t.string(), // JSON-serialized string
  }),
})

let segmentsService: SegmentsService | undefined

function getSegmentsService(): SegmentsService {
  if (!segmentsService) {
    throw new Error('SegmentsService is not initialized')
  }
  return segmentsService
}

function requireUser(context: GraphqlContext): JwtPayload {
  if (!context.user) {
    throw new UnauthorizedException('Authentication required')
  }
  return context.user
}

builder.queryFields((t) => ({
  savedSegments: t.field({
    type: [SavedSegmentRef],
    resolve: async (_parent, _args, context) => {
      const user = requireUser(context)
      const segments = await getSegmentsService().findAll(user.tenantId)
      return segments.map((s) => ({
        id: s.id,
        name: s.name,
        filters: JSON.stringify(s.filters),
        createdBy: s.createdBy,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      }))
    },
  }),
}))

builder.mutationFields((t) => ({
  createSegment: t.field({
    type: SavedSegmentRef,
    args: { input: t.arg({ type: CreateSegmentInputRef, required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      const filters = parseSegmentFilters(args.input.filters)
      const segment = await getSegmentsService().create(user.tenantId, user.userId, {
        name: args.input.name,
        filters,
      })
      return {
        id: segment.id,
        name: segment.name,
        filters: JSON.stringify(segment.filters),
        createdBy: segment.createdBy,
        createdAt: segment.createdAt.toISOString(),
        updatedAt: segment.updatedAt.toISOString(),
      }
    },
  }),
  updateSegment: t.field({
    type: SavedSegmentRef,
    args: {
      id: t.arg.id({ required: true }),
      input: t.arg({ type: UpdateSegmentInputRef, required: true }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      const input: { name?: string; filters?: Record<string, unknown> } = {}
      if (args.input.name != null) {
        input.name = args.input.name
      }
      if (args.input.filters != null) {
        input.filters = parseSegmentFilters(args.input.filters)
      }
      const segment = await getSegmentsService().update(user.tenantId, String(args.id), input)
      return {
        id: segment.id,
        name: segment.name,
        filters: JSON.stringify(segment.filters),
        createdBy: segment.createdBy,
        createdAt: segment.createdAt.toISOString(),
        updatedAt: segment.updatedAt.toISOString(),
      }
    },
  }),
  deleteSegment: t.boolean({
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      return getSegmentsService().delete(user.tenantId, String(args.id))
    },
  }),
}))

export function registerSegmentGraphql(service: SegmentsService): void {
  segmentsService = service
}

function parseSegmentFilters(raw: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new BadRequestException('Filters must be valid JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new BadRequestException('Filters must be a JSON object')
  }
  return parsed as Record<string, unknown>
}
