import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import type { Prisma } from '@prisma/client'
import {
  MAX_DASHBOARDS_PER_USER,
  MAX_WIDGETS_PER_DASHBOARD,
  assertValidWidgetType,
  assertValidWidgetSize,
  assertTypeMatchesSource,
  normalizeWidgetTitle,
  isWidgetSource,
} from './widget-types'
import type { WidgetType, WidgetSource } from './widget-types'
import { validateWidgetConfig } from './widget-config'
import { DASHBOARD_TEMPLATES, resolveRoleTemplate } from './dashboard-templates'
import { SharingService } from '../sharing/sharing.service'

// ─── Select consts (Trap T1 guard) ──────────────────────────────────────────
// Every field a Pothos ref exposes must be in the corresponding select.
// A ref field absent from the select crashes at query time, not compile time.
// ──────────────────────────────────────────────────────────────────────────────

export const DASHBOARD_SELECT = {
  id: true,
  tenantId: true,
  userId: true,
  name: true,
  isDefault: true,
  isSystemGenerated: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  deletedAt: true,
} as const

export const WIDGET_SELECT = {
  id: true,
  tenantId: true,
  dashboardId: true,
  type: true,
  title: true,
  config: true,
  position: true,
  size: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  deletedAt: true,
} as const

/** Row shape returned by DASHBOARD_SELECT — mirrors every field a Pothos ref exposes. */
export type DashboardRow = {
  id: string
  tenantId: string
  userId: string
  name: string
  isDefault: boolean
  isSystemGenerated: boolean
  createdAt: Date
  updatedAt: Date
  createdBy: string
  updatedBy: string
  deletedAt: Date | null
}

/** Row shape returned by WIDGET_SELECT — mirrors every field a Pothos ref exposes. */
export type WidgetRow = {
  id: string
  tenantId: string
  dashboardId: string
  type: string
  title: string
  config: Prisma.JsonValue
  position: number
  size: string
  createdAt: Date
  updatedAt: Date
  createdBy: string
  updatedBy: string
  deletedAt: Date | null
}

export type CreateDashboardInput = {
  name: string
  isDefault?: boolean
}

export type UpdateDashboardInput = {
  name?: string
  isDefault?: boolean
}

export type AddWidgetInput = {
  type: string
  source: string
  title?: string
  config?: unknown
  size?: string
}

export type UpdateWidgetInput = {
  title?: string
  config?: unknown
  size?: string
}

@Injectable()
export class DashboardsService {
  private readonly logger = new Logger(DashboardsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sharing: SharingService,
  ) {}

  // ─── findMany ───────────────────────────────────────────────────────────────────

  async findMany(
    tenantId: string,
    userId: string,
  ): Promise<{
    owned: DashboardRow[]
    sharedWithMe: DashboardRow[]
  }> {
    const owned = await this.prisma.dashboard.findMany({
      where: { tenantId, userId, deletedAt: null },
      select: DASHBOARD_SELECT,
      orderBy: { createdAt: 'asc' },
    })

    const sharedRules = await this.sharing.getSharedWithMe(tenantId, userId, 'DASHBOARD')
    const sharedIds = sharedRules.map((rule) => rule.resourceId)
    const sharedWithMe =
      sharedIds.length > 0
        ? await this.prisma.dashboard.findMany({
            where: { tenantId, id: { in: sharedIds }, deletedAt: null },
            select: DASHBOARD_SELECT,
            orderBy: { createdAt: 'asc' },
          })
        : []

    return { owned, sharedWithMe }
  }

  // ─── findOne ────────────────────────────────────────────────────────────────────

  async findOne(tenantId: string, userId: string, id: string): Promise<DashboardRow> {
    // Owner check
    const dashboard = await this.prisma.dashboard.findFirst({
      where: { id, tenantId, userId, deletedAt: null },
      select: DASHBOARD_SELECT,
    })
    if (dashboard) return dashboard

    // Shared recipient check
    const sharedRules = await this.sharing.getSharedWithMe(tenantId, userId, 'DASHBOARD')
    const sharedIds = sharedRules.map((rule) => rule.resourceId)
    if (sharedIds.length > 0 && sharedIds.includes(id)) {
      const shared = await this.prisma.dashboard.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: DASHBOARD_SELECT,
      })
      if (shared) return shared
    }

    throw new NotFoundException('Dashboard not found')
  }

  // ─── myDashboard (lazy provisioning) ────────────────────────────────────────────

  async myDashboard(tenantId: string, userId: string, roles: string[]): Promise<DashboardRow> {
    const existing = await this.prisma.dashboard.findFirst({
      where: { tenantId, userId, isDefault: true, deletedAt: null },
      select: DASHBOARD_SELECT,
    })
    if (existing) return existing

    // Lazy-provision inside a transaction (idempotent)
    return this.prisma.$transaction(async (tx) => {
      const recheck = await tx.dashboard.findFirst({
        where: { tenantId, userId, isDefault: true, deletedAt: null },
        select: DASHBOARD_SELECT,
      })
      if (recheck) return recheck

      const templateRole = resolveRoleTemplate(roles)
      const template = DASHBOARD_TEMPLATES[templateRole]

      const dashboard = await tx.dashboard.create({
        data: {
          tenantId,
          userId,
          name: template.name,
          isDefault: true,
          isSystemGenerated: true,
          createdBy: userId,
          updatedBy: userId,
        },
        select: DASHBOARD_SELECT,
      })

      await tx.widget.createMany({
        data: template.widgets.map((w, index) => ({
          tenantId,
          dashboardId: dashboard.id,
          type: w.type,
          title: w.title,
          config: { source: w.source },
          position: index,
          size: w.size,
          createdBy: userId,
          updatedBy: userId,
        })),
      })

      this.logger.log(
        `Provisioned default dashboard ${dashboard.id} for user ${userId} (role: ${templateRole})`,
      )

      return dashboard
    })
  }

  // ─── create ─────────────────────────────────────────────────────────────────────

  async create(
    tenantId: string,
    userId: string,
    input: CreateDashboardInput,
  ): Promise<DashboardRow> {
    // Enforce MAX_DASHBOARDS_PER_USER
    const count = await this.prisma.dashboard.count({
      where: { tenantId, userId, deletedAt: null },
    })
    if (count >= MAX_DASHBOARDS_PER_USER) {
      throw new BadRequestException(
        `You cannot have more than ${MAX_DASHBOARDS_PER_USER} dashboards`,
      )
    }

    // Case-insensitive name collision check across ALL the caller's active
    // dashboards. A single findFirst() arbitrary row is insufficient — a
    // duplicate name on any other dashboard must be rejected (AC 20).
    const existing = await this.prisma.dashboard.findMany({
      where: { tenantId, userId, deletedAt: null },
      select: { name: true },
    })
    if (existing.some((d) => d.name.toLowerCase() === input.name.toLowerCase())) {
      throw new ConflictException('A dashboard with this name already exists')
    }

    const dashboard = await this.prisma.dashboard.create({
      data: {
        tenantId,
        userId,
        name: input.name,
        isDefault: input.isDefault ?? false,
        createdBy: userId,
        updatedBy: userId,
      },
      select: DASHBOARD_SELECT,
    })

    await this.audit.log({
      tenantId,
      userId,
      action: 'DASHBOARD_CREATED',
      entity: 'Dashboard',
      entityId: dashboard.id,
      details: { name: input.name },
    })

    return dashboard
  }

  // ─── update ─────────────────────────────────────────────────────────────────────

  async update(
    tenantId: string,
    userId: string,
    id: string,
    input: UpdateDashboardInput,
  ): Promise<DashboardRow> {
    const dashboard = await this.prisma.dashboard.findFirst({
      where: { id, tenantId, userId, deletedAt: null },
      select: DASHBOARD_SELECT,
    })
    if (!dashboard) throw new NotFoundException('Dashboard not found')

    // isDefault clear siblings in a transaction
    if (input.isDefault === true) {
      return this.prisma.$transaction(async (tx) => {
        await tx.dashboard.updateMany({
          where: { tenantId, userId, isDefault: true, deletedAt: null, id: { not: id } },
          data: { isDefault: false, updatedBy: userId },
        })

        const updated = await tx.dashboard.update({
          where: { id },
          data: {
            ...(input.name !== undefined && { name: input.name }),
            isDefault: true,
            updatedBy: userId,
          },
          select: DASHBOARD_SELECT,
        })

        await this.audit.log({
          tenantId,
          userId,
          action: 'DASHBOARD_UPDATED',
          entity: 'Dashboard',
          entityId: id,
          details: input,
        })

        return updated
      })
    }

    const updated = await this.prisma.dashboard.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.isDefault !== undefined && { isDefault: input.isDefault }),
        updatedBy: userId,
      },
      select: DASHBOARD_SELECT,
    })

    await this.audit.log({
      tenantId,
      userId,
      action: 'DASHBOARD_UPDATED',
      entity: 'Dashboard',
      entityId: id,
      details: input,
    })

    return updated
  }

  // ─── delete ─────────────────────────────────────────────────────────────────────

  async delete(tenantId: string, userId: string, id: string): Promise<DashboardRow> {
    const dashboard = await this.prisma.dashboard.findFirst({
      where: { id, tenantId, userId, deletedAt: null },
      select: DASHBOARD_SELECT,
    })
    if (!dashboard) throw new NotFoundException('Dashboard not found')

    // Refuse to delete the last remaining dashboard
    const remainingCount = await this.prisma.dashboard.count({
      where: { tenantId, userId, deletedAt: null, id: { not: id } },
    })
    if (remainingCount === 0) {
      throw new BadRequestException('Your last dashboard cannot be deleted')
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.widget.updateMany({
        where: { dashboardId: id, tenantId, deletedAt: null },
        data: { deletedAt: new Date(), updatedBy: userId },
      })

      const deleted = await tx.dashboard.update({
        where: { id },
        data: { deletedAt: new Date(), updatedBy: userId },
        select: DASHBOARD_SELECT,
      })

      await this.audit.log({
        tenantId,
        userId,
        action: 'DASHBOARD_DELETED',
        entity: 'Dashboard',
        entityId: id,
        details: { name: dashboard.name },
      })

      return deleted
    })
  }

  // ─── addWidget ──────────────────────────────────────────────────────────────────

  async addWidget(
    tenantId: string,
    userId: string,
    dashboardId: string,
    input: AddWidgetInput,
  ): Promise<WidgetRow> {
    // Owner check
    const dashboard = await this.prisma.dashboard.findFirst({
      where: { id: dashboardId, tenantId, userId, deletedAt: null },
      select: { id: true },
    })
    if (!dashboard) throw new NotFoundException('Dashboard not found')

    // Widget count check
    const widgetCount = await this.prisma.widget.count({
      where: { tenantId, dashboardId, deletedAt: null },
    })
    if (widgetCount >= MAX_WIDGETS_PER_DASHBOARD) {
      throw new BadRequestException(
        `Dashboard cannot have more than ${MAX_WIDGETS_PER_DASHBOARD} widgets`,
      )
    }

    assertValidWidgetType(input.type)
    const type = input.type as WidgetType

    if (!isWidgetSource(input.source)) {
      throw new BadRequestException(`Invalid widget source: ${input.source}`)
    }
    const source = input.source as WidgetSource

    assertTypeMatchesSource(type, source)

    const resolvedSize = input.size ?? '1x1'
    assertValidWidgetSize(resolvedSize)

    const resolvedTitle = normalizeWidgetTitle(input.title ?? `Widget ${widgetCount + 1}`)

    const incomingConfig =
      typeof input.config === 'object' && input.config !== null && !Array.isArray(input.config)
        ? (input.config as Record<string, unknown>)
        : {}
    const mergedConfig = validateWidgetConfig({ source: input.source, ...incomingConfig })

    const nextPosition = await this.prisma.widget
      .findFirst({
        where: { tenantId, dashboardId, deletedAt: null },
        orderBy: { position: 'desc' },
        select: { position: true },
      })
      .then((row) => (row?.position ?? -1) + 1)

    const widget = await this.prisma.widget.create({
      data: {
        tenantId,
        dashboardId,
        type: input.type,
        title: resolvedTitle,
        config: mergedConfig as unknown as Prisma.InputJsonValue,
        position: nextPosition,
        size: resolvedSize,
        createdBy: userId,
        updatedBy: userId,
      },
      select: WIDGET_SELECT,
    })

    // Widget mutations write no audit rows (each drag would flood the log)
    return widget
  }

  // ─── updateWidget ───────────────────────────────────────────────────────────────

  async updateWidget(
    tenantId: string,
    userId: string,
    widgetId: string,
    input: UpdateWidgetInput,
  ): Promise<WidgetRow> {
    const widget = await this.prisma.widget.findFirst({
      where: { id: widgetId, tenantId, deletedAt: null },
      select: { ...WIDGET_SELECT, dashboard: { select: { userId: true } } },
    })
    if (!widget) throw new NotFoundException('Widget not found')
    if (widget.dashboard.userId !== userId) throw new NotFoundException('Widget not found')

    const data: Prisma.WidgetUpdateInput = { updatedBy: userId }

    if (input.title !== undefined) {
      data.title = normalizeWidgetTitle(input.title)
    }

    if (input.config !== undefined) {
      const currentConfig =
        typeof widget.config === 'object' && widget.config !== null
          ? (widget.config as Record<string, unknown>)
          : {}
      const incomingConfig =
        typeof input.config === 'object' && input.config !== null && !Array.isArray(input.config)
          ? (input.config as Record<string, unknown>)
          : {}
      const merged = { ...currentConfig, ...incomingConfig }
      data.config = validateWidgetConfig(merged) as unknown as Prisma.InputJsonValue
    }

    if (input.size !== undefined) {
      assertValidWidgetSize(input.size)
      data.size = input.size
    }

    const updated = await this.prisma.widget.update({
      where: { id: widgetId },
      data: data,
      select: WIDGET_SELECT,
    })

    return updated
  }

  // ─── removeWidget ───────────────────────────────────────────────────────────────

  async removeWidget(tenantId: string, userId: string, widgetId: string): Promise<WidgetRow> {
    const widget = await this.prisma.widget.findFirst({
      where: { id: widgetId, tenantId, deletedAt: null },
      select: { ...WIDGET_SELECT, dashboard: { select: { userId: true } } },
    })
    if (!widget) throw new NotFoundException('Widget not found')
    if (widget.dashboard.userId !== userId) throw new NotFoundException('Widget not found')

    const deleted = await this.prisma.widget.update({
      where: { id: widgetId },
      data: { deletedAt: new Date(), updatedBy: userId },
      select: WIDGET_SELECT,
    })

    return deleted
  }

  // ─── reorderWidgets ─────────────────────────────────────────────────────────────

  async reorderWidgets(
    tenantId: string,
    userId: string,
    dashboardId: string,
    orderedWidgetIds: string[],
  ): Promise<WidgetRow[]> {
    // Owner check
    const dashboard = await this.prisma.dashboard.findFirst({
      where: { id: dashboardId, tenantId, userId, deletedAt: null },
      select: { id: true },
    })
    if (!dashboard) throw new NotFoundException('Dashboard not found')

    // Reject empty
    if (orderedWidgetIds.length === 0) {
      throw new BadRequestException('Ordered widget IDs must not be empty')
    }

    // Reject duplicates
    const uniqueIds = new Set(orderedWidgetIds)
    if (uniqueIds.size !== orderedWidgetIds.length) {
      throw new BadRequestException('Ordered widget IDs must not contain duplicates')
    }

    // Load active widget ids
    const activeWidgets = await this.prisma.widget.findMany({
      where: { tenantId, dashboardId, deletedAt: null },
      select: { id: true },
      orderBy: { position: 'asc' },
    })
    const activeIds = new Set(activeWidgets.map((w) => w.id))

    // Reject partial set — submitted set must exactly match full active set
    if (activeIds.size !== uniqueIds.size) {
      throw new BadRequestException(
        'Ordered widget IDs must include every active widget on the dashboard',
      )
    }
    for (const id of orderedWidgetIds) {
      if (!activeIds.has(id)) {
        throw new BadRequestException(
          'Ordered widget IDs must include every active widget on the dashboard',
        )
      }
    }

    return this.prisma.$transaction(async (tx) => {
      for (let i = 0; i < orderedWidgetIds.length; i++) {
        await tx.widget.updateMany({
          where: { id: orderedWidgetIds[i], tenantId, dashboardId, deletedAt: null },
          data: { position: i, updatedBy: userId },
        })
      }

      return tx.widget.findMany({
        where: { tenantId, dashboardId, deletedAt: null },
        select: WIDGET_SELECT,
        orderBy: { position: 'asc' },
      })
    })
  }

  // ─── Widgets query ──────────────────────────────────────────────────────────────

  async widgets(tenantId: string, userId: string, dashboardId: string): Promise<WidgetRow[]> {
    // Ownership or shared access check
    await this.findOne(tenantId, userId, dashboardId)

    return this.prisma.widget.findMany({
      where: { tenantId, dashboardId, deletedAt: null },
      select: WIDGET_SELECT,
      orderBy: { position: 'asc' },
    })
  }

  // ─── ownerName ───────────────────────────────────────────────────────────────
  // Resolves a display name for a dashboard owner so a shared dashboard can be
  // shown as "Shared by <name> · Read only" (AC 72). Falls back to email, then
  // null (the frontend falls back to a generic "Shared" badge).

  async ownerName(tenantId: string, userId: string): Promise<string | null> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId, deletedAt: null },
      select: { firstName: true, lastName: true, email: true },
    })
    if (!user) return null
    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ')
    return fullName || user.email || null
  }
}
