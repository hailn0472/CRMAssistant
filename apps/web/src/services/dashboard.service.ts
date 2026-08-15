/**
 * Dashboard service (Story 6.1) — GraphQL queries and mutations for dashboards.
 *
 * Uses graphqlRequest from @/lib/graphql-client. Every field added to a Pothos
 * ref must land in the corresponding fragment const, or it is silently
 * undefined at runtime (no GraphQL codegen — see notification.service.ts:21-25).
 */
import { graphqlRequest } from '@/lib/graphql-client'

// ─── Fragments ───────────────────────────────────────────────────────────────
// Every field the Pothos refs expose must be here. Missing fields are silently
// undefined at runtime — no codegen to catch drift.

export const DASHBOARD_FIELDS = `
  id
  name
  userId
  ownerName
  isDefault
  isSystemGenerated
  createdAt
  updatedAt
`

export const WIDGET_FIELDS = `
  id
  type
  title
  config {
    source
    dateRangeDays
    stageId
    ownerId
    limit
  }
  position
  size
  createdAt
  updatedAt
`

export const WIDGET_DATA_FIELDS = `
  widgetId
  source
  type
  generatedAt
  permissionLimited
  currency
  metric {
    label
    value
    unit
    trendPercent
    trendDirection
  }
  series {
    key
    label
    color
    points {
      key
      label
      value
      secondaryValue
    }
  }
  rows {
    id
    primaryLabel
    secondaryLabel
    value
    href
    badgeLabel
    badgeTone
  }
  total
`

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DashboardData {
  id: string
  name: string
  userId: string
  ownerName: string | null
  isDefault: boolean
  isSystemGenerated: boolean
  createdAt: string
  updatedAt: string
  widgets?: WidgetData[]
}

export type WidgetType =
  | 'METRIC_CARD'
  | 'LINE_CHART'
  | 'BAR_CHART'
  | 'PIE_CHART'
  | 'TABLE'
  | 'FUNNEL'
  | 'ACTIVITY_FEED'
  | 'TASK_LIST'

export interface WidgetData {
  id: string
  type: WidgetType
  title: string
  config: WidgetConfigData
  position: number
  size: string
  createdAt: string
  updatedAt: string
}

export interface WidgetConfigData {
  source: string
  dateRangeDays: number
  stageId: string | null
  ownerId: string | null
  limit: number
}

export interface WidgetResultData {
  widgetId: string
  source: string
  type: string
  generatedAt: string
  permissionLimited: boolean
  currency: string | null
  metric: {
    label: string
    value: number
    unit: string | null
    trendPercent: number | null
    trendDirection: 'UP' | 'DOWN' | 'FLAT' | null
  } | null
  series: Array<{
    key: string
    label: string
    color: string
    points: Array<{
      key: string
      label: string
      value: number
      secondaryValue: number | null
    }>
  }>
  rows: Array<{
    id: string
    primaryLabel: string
    secondaryLabel: string | null
    value: string | null
    href: string | null
    badgeLabel: string | null
    badgeTone: 'NEUTRAL' | 'WARNING' | 'DANGER' | 'SUCCESS' | null
  }>
  total: number | null
}

export interface DashboardList {
  owned: DashboardData[]
  sharedWithMe: DashboardData[]
}

export interface DashboardShare {
  id: string
  resourceId: string | null
  sharedWithUserId: string | null
  sharedWithTeamId: string | null
  accessLevel: string
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export async function fetchDashboards(): Promise<DashboardList> {
  const result = await graphqlRequest<{ dashboards: DashboardList }>(
    `
    query Dashboards {
      dashboards {
        owned { ${DASHBOARD_FIELDS} }
        sharedWithMe { ${DASHBOARD_FIELDS} }
      }
    }
  `,
    {},
  )
  return result.dashboards
}

export async function fetchDashboard(id: string): Promise<DashboardData> {
  const result = await graphqlRequest<{ dashboard: DashboardData }>(
    `
    query Dashboard($id: ID!) {
      dashboard(id: $id) {
        ${DASHBOARD_FIELDS}
        widgets { ${WIDGET_FIELDS} }
      }
    }
  `,
    { id },
  )
  return result.dashboard
}

export async function fetchMyDashboard(): Promise<DashboardData> {
  const result = await graphqlRequest<{ myDashboard: DashboardData }>(
    `
    query MyDashboard {
      myDashboard {
        ${DASHBOARD_FIELDS}
        widgets { ${WIDGET_FIELDS} }
      }
    }
  `,
    {},
  )
  return result.myDashboard
}

export async function fetchWidgetData(widgetId: string): Promise<WidgetResultData> {
  const result = await graphqlRequest<{ widgetData: WidgetResultData }>(
    `
    query WidgetData($widgetId: ID!) {
      widgetData(widgetId: $widgetId) {
        ${WIDGET_DATA_FIELDS}
      }
    }
  `,
    { widgetId },
  )
  return result.widgetData
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export async function createDashboard(input: {
  name: string
  isDefault?: boolean
}): Promise<DashboardData> {
  const result = await graphqlRequest<{ createDashboard: DashboardData }>(
    `
    mutation CreateDashboard($input: CreateDashboardInput!) {
      createDashboard(input: $input) { ${DASHBOARD_FIELDS} }
    }
  `,
    { input },
  )
  return result.createDashboard
}

export async function updateDashboard(
  id: string,
  input: { name?: string; isDefault?: boolean },
): Promise<DashboardData> {
  const result = await graphqlRequest<{ updateDashboard: DashboardData }>(
    `
    mutation UpdateDashboard($id: String!, $input: UpdateDashboardInput!) {
      updateDashboard(id: $id, input: $input) { ${DASHBOARD_FIELDS} }
    }
  `,
    { id, input },
  )
  return result.updateDashboard
}

export async function deleteDashboard(id: string): Promise<DashboardData> {
  const result = await graphqlRequest<{ deleteDashboard: DashboardData }>(
    `
    mutation DeleteDashboard($id: String!) {
      deleteDashboard(id: $id) { ${DASHBOARD_FIELDS} }
    }
  `,
    { id },
  )
  return result.deleteDashboard
}

export async function addWidget(
  dashboardId: string,
  input: {
    type: string
    source: string
    title?: string
    config?: Record<string, unknown>
    size?: string
  },
): Promise<WidgetData> {
  const result = await graphqlRequest<{ addWidget: WidgetData }>(
    `
    mutation AddWidget($dashboardId: String!, $input: AddWidgetInput!) {
      addWidget(dashboardId: $dashboardId, input: $input) { ${WIDGET_FIELDS} }
    }
  `,
    { dashboardId, input },
  )
  return result.addWidget
}

export async function updateWidget(
  id: string,
  input: {
    title?: string
    config?: Record<string, unknown>
    size?: string
  },
): Promise<WidgetData> {
  const result = await graphqlRequest<{ updateWidget: WidgetData }>(
    `
    mutation UpdateWidget($id: String!, $input: UpdateWidgetInput!) {
      updateWidget(id: $id, input: $input) { ${WIDGET_FIELDS} }
    }
  `,
    { id, input },
  )
  return result.updateWidget
}

export async function removeWidget(id: string): Promise<WidgetData> {
  const result = await graphqlRequest<{ removeWidget: WidgetData }>(
    `
    mutation RemoveWidget($id: String!) {
      removeWidget(id: $id) { ${WIDGET_FIELDS} }
    }
  `,
    { id },
  )
  return result.removeWidget
}

export async function reorderWidgets(
  dashboardId: string,
  orderedWidgetIds: string[],
): Promise<WidgetData[]> {
  const result = await graphqlRequest<{ reorderWidgets: WidgetData[] }>(
    `
    mutation ReorderWidgets($dashboardId: String!, $orderedWidgetIds: [String!]!) {
      reorderWidgets(dashboardId: $dashboardId, orderedWidgetIds: $orderedWidgetIds) { ${WIDGET_FIELDS} }
    }
  `,
    { dashboardId, orderedWidgetIds },
  )
  return result.reorderWidgets
}

export async function shareDashboard(
  dashboardId: string,
  sharedWithUserId?: string,
  sharedWithTeamId?: string,
): Promise<DashboardShare> {
  const result = await graphqlRequest<{ shareDashboard: DashboardShare }>(
    `
    mutation ShareDashboard($dashboardId: String!, $sharedWithUserId: String, $sharedWithTeamId: String, $accessLevel: String!) {
      shareDashboard(dashboardId: $dashboardId, sharedWithUserId: $sharedWithUserId, sharedWithTeamId: $sharedWithTeamId, accessLevel: $accessLevel) {
        id
        resourceId
        sharedWithUserId
        sharedWithTeamId
        accessLevel
      }
    }
  `,
    { dashboardId, sharedWithUserId, sharedWithTeamId, accessLevel: 'READ' },
  )
  return result.shareDashboard
}

export async function unshareDashboard(shareId: string): Promise<boolean> {
  const result = await graphqlRequest<{ unshareDashboard: boolean }>(
    `
    mutation UnshareDashboard($shareId: String!) {
      unshareDashboard(shareId: $shareId)
    }
  `,
    { shareId },
  )
  return result.unshareDashboard
}

export async function fetchDashboardShares(dashboardId: string): Promise<DashboardShare[]> {
  const result = await graphqlRequest<{ dashboardShares: DashboardShare[] }>(
    `
    query DashboardShares($dashboardId: ID!) {
      dashboardShares(dashboardId: $dashboardId) {
        id
        resourceId
        sharedWithUserId
        sharedWithTeamId
        accessLevel
      }
    }
  `,
    { dashboardId },
  )
  return result.dashboardShares
}
