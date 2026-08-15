import {
  DASHBOARD_TEMPLATES,
  resolveRoleTemplate,
  validateTemplateConstraints,
} from '../dashboard-templates'

describe('dashboard-templates', () => {
  // ─── AC 19 ──────────────────────────────────────────────────────
  describe('resolveRoleTemplate', () => {
    it('returns ADMIN for ADMIN-containing array', () => {
      expect(resolveRoleTemplate(['ADMIN'])).toBe('ADMIN')
    })

    it('returns ADMIN regardless of array order (precedence, not order)', () => {
      expect(resolveRoleTemplate(['SALES_REP', 'ADMIN'])).toBe('ADMIN')
    })

    it('returns SALES_MANAGER when only manager present', () => {
      expect(resolveRoleTemplate(['SALES_MANAGER'])).toBe('SALES_MANAGER')
    })

    it('returns SALES_MANAGER over SALES_REP', () => {
      expect(resolveRoleTemplate(['SALES_REP', 'SALES_MANAGER'])).toBe('SALES_MANAGER')
    })

    it('returns SALES_REP for rep-only', () => {
      expect(resolveRoleTemplate(['SALES_REP'])).toBe('SALES_REP')
    })

    it('returns DEFAULT for empty array', () => {
      expect(resolveRoleTemplate([])).toBe('DEFAULT')
    })

    it('returns DEFAULT for SUPPORT_AGENT', () => {
      expect(resolveRoleTemplate(['SUPPORT_AGENT'])).toBe('DEFAULT')
    })

    it('returns DEFAULT for MARKETING_USER', () => {
      expect(resolveRoleTemplate(['MARKETING_USER'])).toBe('DEFAULT')
    })

    it('returns DEFAULT for a custom role', () => {
      expect(resolveRoleTemplate(['CUSTOMER'])).toBe('DEFAULT')
    })
  })

  // ─── AC 20 ──────────────────────────────────────────────────────
  describe('template constraints (anti-clutter rules)', () => {
    it('every template has widgets.length <= MAX_WIDGETS_PER_DASHBOARD', () => {
      for (const template of Object.values(DASHBOARD_TEMPLATES)) {
        const errors = validateTemplateConstraints(template)
        const widgetCountErrors = errors.filter((e) => e.includes('widgets'))
        expect(widgetCountErrors).toHaveLength(0)
      }
    })

    it('every template has metricCardCount <= 4', () => {
      for (const template of Object.values(DASHBOARD_TEMPLATES)) {
        const errors = validateTemplateConstraints(template)
        const metricCardErrors = errors.filter((e) => e.includes('metric cards'))
        expect(metricCardErrors).toHaveLength(0)
      }
    })

    it('every template has chartCount <= 1', () => {
      for (const template of Object.values(DASHBOARD_TEMPLATES)) {
        const errors = validateTemplateConstraints(template)
        const chartErrors = errors.filter((e) => e.includes('charts'))
        expect(chartErrors).toHaveLength(0)
      }
    })

    it('every (type, source) pair passes assertTypeMatchesSource', () => {
      for (const template of Object.values(DASHBOARD_TEMPLATES)) {
        const errors = validateTemplateConstraints(template)
        expect(errors).toHaveLength(0)
      }
    })

    it('Sales Rep has exactly FUNNEL as its sole chart', () => {
      const template = DASHBOARD_TEMPLATES.SALES_REP
      const chartTypes = ['LINE_CHART', 'BAR_CHART', 'PIE_CHART', 'FUNNEL'] as const
      const charts = template.widgets.filter((w) => chartTypes.includes(w.type as never))
      expect(charts).toHaveLength(1)
      expect(charts[0].type).toBe('FUNNEL')
    })

    it('Sales Manager has exactly LINE_CHART as its sole chart', () => {
      const template = DASHBOARD_TEMPLATES.SALES_MANAGER
      const chartTypes = ['LINE_CHART', 'BAR_CHART', 'PIE_CHART', 'FUNNEL'] as const
      const charts = template.widgets.filter((w) => chartTypes.includes(w.type as never))
      expect(charts).toHaveLength(1)
      expect(charts[0].type).toBe('LINE_CHART')
    })

    it('Admin has exactly BAR_CHART as its sole chart', () => {
      const template = DASHBOARD_TEMPLATES.ADMIN
      const chartTypes = ['LINE_CHART', 'BAR_CHART', 'PIE_CHART', 'FUNNEL'] as const
      const charts = template.widgets.filter((w) => chartTypes.includes(w.type as never))
      expect(charts).toHaveLength(1)
      expect(charts[0].type).toBe('BAR_CHART')
    })

    it('Default has 0 charts', () => {
      const template = DASHBOARD_TEMPLATES.DEFAULT
      const chartTypes = ['LINE_CHART', 'BAR_CHART', 'PIE_CHART', 'FUNNEL'] as const
      const charts = template.widgets.filter((w) => chartTypes.includes(w.type as never))
      expect(charts).toHaveLength(0)
    })

    it('Sales Rep has 3 metric cards', () => {
      const template = DASHBOARD_TEMPLATES.SALES_REP
      const metricCards = template.widgets.filter((w) => w.type === 'METRIC_CARD')
      expect(metricCards).toHaveLength(3)
    })

    it('Sales Manager has 4 metric cards', () => {
      const template = DASHBOARD_TEMPLATES.SALES_MANAGER
      const metricCards = template.widgets.filter((w) => w.type === 'METRIC_CARD')
      expect(metricCards).toHaveLength(4)
    })

    it('Admin has 3 metric cards', () => {
      const template = DASHBOARD_TEMPLATES.ADMIN
      const metricCards = template.widgets.filter((w) => w.type === 'METRIC_CARD')
      expect(metricCards).toHaveLength(3)
    })

    it('Default has 2 metric cards', () => {
      const template = DASHBOARD_TEMPLATES.DEFAULT
      const metricCards = template.widgets.filter((w) => w.type === 'METRIC_CARD')
      expect(metricCards).toHaveLength(2)
    })
  })
})
