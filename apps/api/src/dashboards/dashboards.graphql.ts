/**
 * Dashboard GraphQL module (Story 6.1).
 *
 * Pothos-enforced GraphQL surface for dashboards and widgets.
 * Self-scoped queries (no requirePermission) following the notifications precedent.
 * widgetData carries two gates: REPORT:READ + source-specific permission (AC 31).
 *
 * Enums are derived from the const tuples in widget-types.ts (AC 46 — never a
 * second vocabulary); object refs are derived from the service return types
 * (AC 47 — a ref field cannot outrun the service, Trap T1).
 */
/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/explicit-module-boundary-types */

import { BadRequestException, UnauthorizedException } from '@nestjs/common'
import type { SharingRule } from '@prisma/client'

import { builder } from '../graphql/schema.builder'
import type { GraphqlContext } from '../graphql/graphql-context'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'
import { requirePermission } from '../common/guards/permission-check'
import type { DashboardsService, DashboardRow, WidgetRow } from './dashboards.service'
import type { WidgetDataService, WidgetDataResult } from './widget-data.service'
import type { SharingService } from '../sharing/sharing.service'
import { parseWidgetConfig } from './widget-config'
import { WIDGET_TYPES, WIDGET_SIZES, WIDGET_SOURCES } from './widget-types'
import type { WidgetType, WidgetSize, WidgetSource } from './widget-types'

// ─── Module-scope singletons ────────────────────────────────────────────

let _dashboardsService: DashboardsService | undefined
let _widgetDataService: WidgetDataService | undefined
let _sharingService: SharingService | undefined

function getDashboardsService(): DashboardsService {
  if (!_dashboardsService) throw new Error('DashboardsService is not initialized')
  return _dashboardsService
}

function getWidgetDataService(): WidgetDataService {
  if (!_widgetDataService) throw new Error('WidgetDataService is not initialized')
  return _widgetDataService
}

function getSharingService(): SharingService {
  if (!_sharingService) throw new Error('SharingService is not initialized')
  return _sharingService
}

function requireUser(context: GraphqlContext): JwtPayload {
  if (!context.user) throw new UnauthorizedException('Authentication required')
  return context.user
}

// ─── Enums (derived from const tuples — AC 46) ──────────────────────────

const WidgetTypeRef = builder.enumType('WidgetType', { values: WIDGET_TYPES })

// GraphQL enum names must be valid identifiers, so each size is mapped to a
// SIZE_NxN label — still derived from the WIDGET_SIZES tuple, not hand-copied.
const WIDGET_SIZE_VALUES: Record<string, { value: WidgetSize }> = Object.fromEntries(
  WIDGET_SIZES.map(
    (size) =>
      [`SIZE_${size.replace('x', 'X')}`, { value: size }] as [string, { value: WidgetSize }],
  ),
)
const WidgetSizeRef = builder.enumType('WidgetSize', { values: WIDGET_SIZE_VALUES })

const WIDGET_SOURCE_VALUES = Object.keys(WIDGET_SOURCES) as WidgetSource[]
const WidgetSourceRef = builder.enumType('WidgetSource', { values: WIDGET_SOURCE_VALUES })

const TrendDirectionRef = builder.enumType('TrendDirection', {
  values: ['UP', 'DOWN', 'FLAT'] as const,
})

const BadgeToneRef = builder.enumType('BadgeTone', {
  values: ['NEUTRAL', 'WARNING', 'DANGER', 'SUCCESS'] as const,
})

// ─── Object Refs ────────────────────────────────────────────────────────

const WidgetConfigRef = builder.objectRef<ReturnType<typeof parseWidgetConfig>>('WidgetConfig')
WidgetConfigRef.implement({
  fields: (t) => ({
    source: t.field({ type: WidgetSourceRef, resolve: (p) => p.source }),
    dateRangeDays: t.int({ resolve: (p) => p.dateRangeDays }),
    stageId: t.string({ nullable: true, resolve: (p) => p.stageId }),
    ownerId: t.string({ nullable: true, resolve: (p) => p.ownerId }),
    limit: t.int({ resolve: (p) => p.limit }),
  }),
})

const WidgetRef = builder.objectRef<WidgetRow>('Widget')
WidgetRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    type: t.field({ type: WidgetTypeRef, resolve: (p) => p.type as WidgetType }),
    title: t.exposeString('title'),
    config: t.field({ type: WidgetConfigRef, resolve: (p) => parseWidgetConfig(p.config) }),
    position: t.exposeInt('position'),
    size: t.field({ type: WidgetSizeRef, resolve: (p) => p.size as WidgetSize }),
    createdAt: t.string({ resolve: (p) => p.createdAt.toISOString() }),
    updatedAt: t.string({ resolve: (p) => p.updatedAt.toISOString() }),
  }),
})

// Nested data refs derived from the WidgetDataService return type (AC 47).
const WidgetMetricRef = builder.objectRef<NonNullable<WidgetDataResult['metric']>>('WidgetMetric')
WidgetMetricRef.implement({
  fields: (t) => ({
    label: t.exposeString('label'),
    value: t.exposeFloat('value'),
    unit: t.string({ nullable: true, resolve: (p) => p.unit }),
    trendPercent: t.float({ nullable: true, resolve: (p) => p.trendPercent }),
    trendDirection: t.field({
      type: TrendDirectionRef,
      nullable: true,
      resolve: (p) => p.trendDirection,
    }),
  }),
})

const WidgetPointRef =
  builder.objectRef<WidgetDataResult['series'][number]['points'][number]>('WidgetPoint')
WidgetPointRef.implement({
  fields: (t) => ({
    key: t.exposeString('key'),
    label: t.exposeString('label'),
    value: t.exposeFloat('value'),
    secondaryValue: t.float({ nullable: true, resolve: (p) => p.secondaryValue }),
  }),
})

const WidgetSeriesRef = builder.objectRef<WidgetDataResult['series'][number]>('WidgetSeries')
WidgetSeriesRef.implement({
  fields: (t) => ({
    key: t.exposeString('key'),
    label: t.exposeString('label'),
    color: t.exposeString('color'),
    points: t.field({ type: [WidgetPointRef], resolve: (p) => p.points }),
  }),
})

const WidgetRowRef = builder.objectRef<WidgetDataResult['rows'][number]>('WidgetRow')
WidgetRowRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    primaryLabel: t.exposeString('primaryLabel'),
    secondaryLabel: t.string({ nullable: true, resolve: (p) => p.secondaryLabel }),
    value: t.string({ nullable: true, resolve: (p) => p.value }),
    href: t.string({ nullable: true, resolve: (p) => p.href }),
    badgeLabel: t.string({ nullable: true, resolve: (p) => p.badgeLabel }),
    badgeTone: t.field({ type: BadgeToneRef, nullable: true, resolve: (p) => p.badgeTone }),
  }),
})

const WidgetDataRef = builder.objectRef<WidgetDataResult>('WidgetData')
WidgetDataRef.implement({
  fields: (t) => ({
    widgetId: t.exposeID('widgetId'),
    source: t.field({ type: WidgetSourceRef, resolve: (p) => p.source }),
    type: t.field({ type: WidgetTypeRef, resolve: (p) => p.type }),
    generatedAt: t.exposeString('generatedAt'),
    permissionLimited: t.exposeBoolean('permissionLimited'),
    currency: t.string({ nullable: true, resolve: (p) => p.currency }),
    metric: t.field({ type: WidgetMetricRef, nullable: true, resolve: (p) => p.metric }),
    series: t.field({ type: [WidgetSeriesRef], resolve: (p) => p.series }),
    rows: t.field({ type: [WidgetRowRef], resolve: (p) => p.rows }),
    total: t.float({ nullable: true, resolve: (p) => p.total }),
  }),
})

const DashboardRef = builder.objectRef<DashboardRow>('Dashboard')
DashboardRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    userId: t.exposeString('userId'),
    ownerName: t.string({
      nullable: true,
      resolve: async (parent, _args, context: GraphqlContext) => {
        const user = requireUser(context)
        return getDashboardsService().ownerName(user.tenantId, parent.userId)
      },
    }),
    isDefault: t.exposeBoolean('isDefault'),
    isSystemGenerated: t.exposeBoolean('isSystemGenerated'),
    widgets: t.field({
      type: [WidgetRef],
      // N+1 note (deferred): resolving `widgets` here fires one query per
      // dashboard when `dashboards` fans out over many rows. A dataloader batch
      // would collapse it, but no dataloader dependency is installed and the
      // owned+shared dashboard count is bounded by MAX_DASHBOARDS_PER_USER (10).
      resolve: async (parent, _args, context: GraphqlContext) => {
        const user = requireUser(context)
        return getDashboardsService().widgets(user.tenantId, user.userId, parent.id)
      },
    }),
    createdAt: t.string({ resolve: (p) => p.createdAt.toISOString() }),
    updatedAt: t.string({ resolve: (p) => p.updatedAt.toISOString() }),
  }),
})

const DashboardListRef = builder.objectRef<{ owned: DashboardRow[]; sharedWithMe: DashboardRow[] }>(
  'DashboardList',
)
DashboardListRef.implement({
  fields: (t) => ({
    owned: t.field({ type: [DashboardRef], resolve: (p) => p.owned }),
    sharedWithMe: t.field({ type: [DashboardRef], resolve: (p) => p.sharedWithMe }),
  }),
})

const DashboardShareRef = builder.objectRef<SharingRule>('DashboardShare')
DashboardShareRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    resourceId: t.string({ nullable: true, resolve: (p) => p.resourceId ?? null }),
    sharedWithUserId: t.string({ nullable: true, resolve: (p) => p.sharedWithUserId ?? null }),
    sharedWithTeamId: t.string({ nullable: true, resolve: (p) => p.sharedWithTeamId ?? null }),
    accessLevel: t.string({ resolve: (p) => String(p.accessLevel) }),
  }),
})

// ─── Inputs ─────────────────────────────────────────────────────────────

const WidgetConfigInputRef = builder.inputType('WidgetConfigInput', {
  fields: (t) => ({
    source: t.string({ required: true }),
    dateRangeDays: t.int({ required: false }),
    stageId: t.string({ required: false }),
    ownerId: t.string({ required: false }),
    limit: t.int({ required: false }),
  }),
})

const CreateDashboardInputRef = builder.inputType('CreateDashboardInput', {
  fields: (t) => ({
    name: t.string({ required: true }),
    isDefault: t.boolean({ required: false }),
  }),
})

const UpdateDashboardInputRef = builder.inputType('UpdateDashboardInput', {
  fields: (t) => ({
    name: t.string({ required: false }),
    isDefault: t.boolean({ required: false }),
  }),
})

const AddWidgetInputRef = builder.inputType('AddWidgetInput', {
  fields: (t) => ({
    type: t.string({ required: true }),
    source: t.string({ required: true }),
    title: t.string({ required: false }),
    config: t.field({ type: WidgetConfigInputRef, required: false }),
    size: t.string({ required: false }),
  }),
})

const UpdateWidgetInputRef = builder.inputType('UpdateWidgetInput', {
  fields: (t) => ({
    title: t.string({ required: false }),
    config: t.field({ type: WidgetConfigInputRef, required: false }),
    size: t.string({ required: false }),
  }),
})

// ─── Queries ────────────────────────────────────────────────────────────

builder.queryFields((t) => ({
  dashboards: t.field({
    type: DashboardListRef,
    resolve: async (_parent, _args, context: GraphqlContext) => {
      const user = requireUser(context)
      // Self-scoped — no requirePermission
      return getDashboardsService().findMany(user.tenantId, user.userId)
    },
  }),

  dashboard: t.field({
    type: DashboardRef,
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context: GraphqlContext) => {
      const user = requireUser(context)
      // Self-scoped — no requirePermission
      return getDashboardsService().findOne(user.tenantId, user.userId, args.id)
    },
  }),

  myDashboard: t.field({
    type: DashboardRef,
    resolve: async (_parent, _args, context: GraphqlContext) => {
      const user = requireUser(context)
      // Self-scoped — no requirePermission; passes the caller's roles for template resolution.
      return getDashboardsService().myDashboard(user.tenantId, user.userId, user.roles)
    },
  }),

  widgetData: t.field({
    type: WidgetDataRef,
    args: { widgetId: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context: GraphqlContext) => {
      const user = requireUser(context)
      return getWidgetDataService().widgetData(
        user.tenantId,
        user.userId,
        args.widgetId,
        // AC 31 — the two gates run through the shared requirePermission guard
        // (bound to the GraphQL context), not a raw context object.
        {
          requirePermission: (resource: string, action: string) =>
            requirePermission(context, resource, action),
        },
      )
    },
  }),

  // AC 43 — owner-only list of sharing rules for a dashboard. Reuses
  // SharingService.getSharingRules; names are resolved client-side from the
  // already-loaded users/teams lists in ShareDashboardDialog.
  dashboardShares: t.field({
    type: [DashboardShareRef],
    args: { dashboardId: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context: GraphqlContext) => {
      const user = requireUser(context)
      return getSharingService().getSharingRules(
        user.tenantId,
        user.userId,
        'DASHBOARD',
        args.dashboardId,
      )
    },
  }),
}))

// ─── Mutations ──────────────────────────────────────────────────────────

builder.mutationFields((t) => ({
  createDashboard: t.field({
    type: DashboardRef,
    args: { input: t.arg({ type: CreateDashboardInputRef, required: true }) },
    resolve: async (_parent, args, context: GraphqlContext) => {
      const user = requireUser(context)
      return getDashboardsService().create(user.tenantId, user.userId, {
        name: args.input.name,
        isDefault: args.input.isDefault ?? undefined,
      })
    },
  }),

  updateDashboard: t.field({
    type: DashboardRef,
    args: {
      id: t.arg.string({ required: true }),
      input: t.arg({ type: UpdateDashboardInputRef, required: true }),
    },
    resolve: async (_parent, args, context: GraphqlContext) => {
      const user = requireUser(context)
      return getDashboardsService().update(user.tenantId, user.userId, args.id, {
        name: args.input.name ?? undefined,
        isDefault: args.input.isDefault ?? undefined,
      })
    },
  }),

  deleteDashboard: t.field({
    type: DashboardRef,
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_parent, args, context: GraphqlContext) => {
      const user = requireUser(context)
      return getDashboardsService().delete(user.tenantId, user.userId, args.id)
    },
  }),

  addWidget: t.field({
    type: WidgetRef,
    args: {
      dashboardId: t.arg.string({ required: true }),
      input: t.arg({ type: AddWidgetInputRef, required: true }),
    },
    resolve: async (_parent, args, context: GraphqlContext) => {
      const user = requireUser(context)
      return getDashboardsService().addWidget(user.tenantId, user.userId, args.dashboardId, {
        type: args.input.type,
        source: args.input.source,
        title: args.input.title ?? undefined,
        config: args.input.config ?? undefined,
        size: args.input.size ?? undefined,
      })
    },
  }),

  updateWidget: t.field({
    type: WidgetRef,
    args: {
      id: t.arg.string({ required: true }),
      input: t.arg({ type: UpdateWidgetInputRef, required: true }),
    },
    resolve: async (_parent, args, context: GraphqlContext) => {
      const user = requireUser(context)
      return getDashboardsService().updateWidget(user.tenantId, user.userId, args.id, {
        title: args.input.title ?? undefined,
        config: args.input.config ?? undefined,
        size: args.input.size ?? undefined,
      })
    },
  }),

  removeWidget: t.field({
    type: WidgetRef,
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_parent, args, context: GraphqlContext) => {
      const user = requireUser(context)
      return getDashboardsService().removeWidget(user.tenantId, user.userId, args.id)
    },
  }),

  reorderWidgets: t.field({
    type: [WidgetRef],
    args: {
      dashboardId: t.arg.string({ required: true }),
      orderedWidgetIds: t.arg.stringList({ required: true }),
    },
    resolve: async (_parent, args, context: GraphqlContext) => {
      const user = requireUser(context)
      return getDashboardsService().reorderWidgets(
        user.tenantId,
        user.userId,
        args.dashboardId,
        args.orderedWidgetIds,
      )
    },
  }),

  shareDashboard: t.field({
    type: DashboardShareRef,
    args: {
      dashboardId: t.arg.string({ required: true }),
      sharedWithUserId: t.arg.string({ required: false }),
      sharedWithTeamId: t.arg.string({ required: false }),
      accessLevel: t.arg.string({ required: true }),
    },
    resolve: async (_parent, args, context: GraphqlContext) => {
      const user = requireUser(context)
      if (args.accessLevel !== 'READ') {
        throw new BadRequestException('Dashboards can only be shared with READ access')
      }
      // Routed through SharingService.create (not the generic shareRecord
      // mutation) because sharing.graphql.ts:129 hardcodes a CONTACT:UPDATE
      // gate on unshareRecord that MARKETING_USER does not hold (AC 44).
      return getSharingService().create(user.tenantId, user.userId, {
        resourceType: 'DASHBOARD',
        resourceId: args.dashboardId,
        sharedWithUserId: args.sharedWithUserId ?? undefined,
        sharedWithTeamId: args.sharedWithTeamId ?? undefined,
        accessLevel: 'READ',
      })
    },
  }),

  unshareDashboard: t.field({
    type: 'Boolean',
    args: { shareId: t.arg.string({ required: true }) },
    resolve: async (_parent, args, context: GraphqlContext) => {
      const user = requireUser(context)
      return getSharingService().unshare(user.tenantId, user.userId, args.shareId)
    },
  }),
}))

// ─── Registration ───────────────────────────────────────────────────────

export function registerDashboardsGraphql(
  dashboards: DashboardsService,
  widgetData: WidgetDataService,
  sharing: SharingService,
): void {
  _dashboardsService = dashboards
  _widgetDataService = widgetData
  _sharingService = sharing
}
