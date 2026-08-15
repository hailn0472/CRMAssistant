/**
 * Pure dashboard-templates module (Story 6.1).
 *
 * Framework-free, Nest-free, Prisma-free. Defines the four role-based default
 * dashboard templates and the role-precedence resolver.
 *
 * Templates carry no explicit position — Widget.position is the array index
 * at provisioning time, so template array order IS the layout order and
 * the two cannot drift.
 */

import type { WidgetSize, WidgetType, WidgetSource } from './widget-types'
import { MAX_WIDGETS_PER_DASHBOARD, assertTypeMatchesSource } from './widget-types'

export interface DashboardTemplateWidget {
  type: WidgetType
  source: WidgetSource
  size: WidgetSize
  title: string
}

export interface DashboardTemplate {
  name: string
  widgets: DashboardTemplateWidget[]
}

/**
 * Role precedence mirrors ROLE_PRIORITY in AppShellNavigation.tsx:289-311.
 * ADMIN > SALES_MANAGER > SALES_REP; anything else → DEFAULT.
 */
export type TemplateRole = 'ADMIN' | 'SALES_MANAGER' | 'SALES_REP' | 'DEFAULT'

export const DASHBOARD_TEMPLATES: Record<TemplateRole, DashboardTemplate> = {
  SALES_REP: {
    name: 'Sales Dashboard',
    widgets: [
      { type: 'METRIC_CARD', source: 'TASK_STATS', size: '1x1', title: 'Task Stats' },
      { type: 'METRIC_CARD', source: 'PIPELINE_VALUE', size: '1x1', title: 'Pipeline Value' },
      { type: 'METRIC_CARD', source: 'CONTACT_COUNT', size: '1x1', title: 'Contact Count' },
      { type: 'TABLE', source: 'AT_RISK_DEALS', size: '2x2', title: 'At-Risk Deals' },
      { type: 'TASK_LIST', source: 'MY_TASKS', size: '2x2', title: 'My Tasks' },
      { type: 'FUNNEL', source: 'PIPELINE_BY_STAGE', size: '2x2', title: 'Sales Funnel' },
      { type: 'ACTIVITY_FEED', source: 'RECENT_ACTIVITY', size: '2x2', title: 'Recent Activity' },
    ],
  },
  SALES_MANAGER: {
    name: 'Sales Manager Dashboard',
    widgets: [
      { type: 'METRIC_CARD', source: 'PIPELINE_VALUE', size: '1x1', title: 'Pipeline Value' },
      { type: 'METRIC_CARD', source: 'TASK_STATS', size: '1x1', title: 'Task Stats' },
      { type: 'METRIC_CARD', source: 'WIN_LOSS', size: '1x1', title: 'Win/Loss Ratio' },
      { type: 'METRIC_CARD', source: 'CONTACT_COUNT', size: '1x1', title: 'Contact Count' },
      { type: 'LINE_CHART', source: 'SALES_FORECAST', size: '3x2', title: 'Sales Forecast' },
      { type: 'TABLE', source: 'AT_RISK_DEALS', size: '2x2', title: 'At-Risk Deals' },
      { type: 'ACTIVITY_FEED', source: 'RECENT_ACTIVITY', size: '2x2', title: 'Recent Activity' },
    ],
  },
  ADMIN: {
    name: 'Admin Dashboard',
    widgets: [
      { type: 'METRIC_CARD', source: 'CONTACT_COUNT', size: '1x1', title: 'Contact Count' },
      { type: 'METRIC_CARD', source: 'TASK_STATS', size: '1x1', title: 'Task Stats' },
      { type: 'METRIC_CARD', source: 'PIPELINE_VALUE', size: '1x1', title: 'Pipeline Value' },
      { type: 'BAR_CHART', source: 'TIME_TRACKED', size: '3x2', title: 'Time Tracked' },
      { type: 'ACTIVITY_FEED', source: 'RECENT_ACTIVITY', size: '2x2', title: 'Recent Activity' },
    ],
  },
  DEFAULT: {
    name: 'My Dashboard',
    widgets: [
      { type: 'METRIC_CARD', source: 'TASK_STATS', size: '1x1', title: 'Task Stats' },
      { type: 'METRIC_CARD', source: 'CONTACT_COUNT', size: '1x1', title: 'Contact Count' },
      { type: 'TASK_LIST', source: 'MY_TASKS', size: '2x2', title: 'My Tasks' },
      { type: 'ACTIVITY_FEED', source: 'RECENT_ACTIVITY', size: '2x2', title: 'Recent Activity' },
    ],
  },
}

const ROLE_PRECEDENCE: string[] = ['ADMIN', 'SALES_MANAGER', 'SALES_REP']

export function resolveRoleTemplate(roles: string[]): TemplateRole {
  for (const role of ROLE_PRECEDENCE) {
    if (roles.includes(role)) {
      return role as TemplateRole
    }
  }
  return 'DEFAULT'
}

/**
 * Validate a template against the anti-clutter rules (AC 20).
 */
export function validateTemplateConstraints(template: DashboardTemplate): string[] {
  const errors: string[] = []

  if (template.widgets.length > MAX_WIDGETS_PER_DASHBOARD) {
    errors.push(
      `Template has ${template.widgets.length} widgets, max is ${MAX_WIDGETS_PER_DASHBOARD}`,
    )
  }

  const metricCardCount = template.widgets.filter((w) => w.type === 'METRIC_CARD').length
  if (metricCardCount > 4) {
    errors.push(`Template has ${metricCardCount} metric cards, max is 4`)
  }

  const chartTypes: WidgetType[] = ['LINE_CHART', 'BAR_CHART', 'PIE_CHART', 'FUNNEL']
  const chartCount = template.widgets.filter((w) => chartTypes.includes(w.type)).length
  if (chartCount > 1) {
    errors.push(`Template has ${chartCount} charts, max is 1`)
  }

  for (const widget of template.widgets) {
    try {
      assertTypeMatchesSource(widget.type, widget.source)
    } catch (e) {
      errors.push((e as Error).message)
    }
  }

  return errors
}
