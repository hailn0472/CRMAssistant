import { expect, test } from '@playwright/test'

import { applyAuthCookie } from '../support/helpers/auth'

// ===========================================================================
// Story 6.8 — Activity Reports & Team Productivity Metrics — E2E
//   tests/e2e/activity-reports.spec.ts
//
// APPROACH: fully self-contained, CI-safe, deterministic (Contract F37).
// Every client-side GraphQL call (query MyPermissions, SearchUsers, Teams,
// ActivityReport, ActivityUserDrillDown, ActivityGoals, goal mutations,
// ExportActivityReport, ReportExportDownloadUrl) is fulfilled in-browser via
// page.route('**/api/graphql'). The signed-download URL is a mocked
// cross-origin host (https://mock-signed-url.example/...) whose response is
// also fulfilled via page.route, so the suite needs NO live API backend, NO
// database, NO Supabase credentials. The web app runs standalone
// (`pnpm --filter=web dev:ci` with a dummy JWT secret, exactly like CI
// e2e.yml — see playwright-e2e skill §29). Formulas and the daily goal
// processor workflow are API integration-tier (Contract F37), not tested here.
//
// Binding AC coverage map:
//   AC 6   — E2E-AR-01 (route renders full dashboard), E2E-AR-02 (nav +
//            breadcrumb), E2E-AR-07 (permission denied + export gating),
//            E2E-AR-08 (error/empty states), E2E-AR-10 (loading skeleton)
//   AC 7-8 — E2E-AR-01 (heatmap 7×24 role=img + sr-only table + zero cells,
//            trend section, leaderboard section)
//   AC 9   — E2E-AR-01 (leaderboard rows with 4 metrics + rank), E2E-AR-03
//            (sortable column headers dispatch sortBy)
//   AC 10  — E2E-AR-03 (date range, user, team, activity type, contact/deal,
//            team comparison filters → exact variables; Reset; invalid range
//            blocked inline without dispatching a query)
//   AC 11  — E2E-AR-01 (team comparison cards render per-team metrics)
//   AC 12  — E2E-AR-04 (leaderboard user drill-down opens lazy panel,
//            per-user breakdown + recent activities, close without refetch,
//            no unintended mutations)
//   AC 13-14 — E2E-AR-05 (goal lifecycle: create → progress bar + %,
//            edit, delete; progress values come from the fixture)
//   AC 16  — E2E-AR-06 (Export button visible; menu PDF/EXCEL only — no CSV;
//            READY → download with exact filename; mutation carries filters)
// ===========================================================================

const API_JWT_SECRET: string =
  process.env['API_JWT_SECRET'] ?? 'Con{D!b<;!-6?SwR+#dg2sMOciD)W7tOcv_sz$LF}S%'

// Signed-URL mock host — never touches a real bucket.
const SIGNED_URL_ORIGIN = 'https://mock-signed-url.example'

// ---------------------------------------------------------------------------
// Types (mirror apps/web/src/services/activity-report.service.ts)
// ---------------------------------------------------------------------------

type ActivityTypeValue =
  | 'EMAIL_SENT'
  | 'CALL_MADE'
  | 'MEETING_SCHEDULED'
  | 'NOTE_ADDED'
  | 'DEAL_CREATED'
  | 'CONTACT_CREATED'
  | 'CONTACT_UPDATED'
  | 'CONTACT_OWNER_CHANGED'
  | 'TASK_COMPLETED'
  | 'DEAL_STAGE_CHANGED'
  | 'MESSAGE_RECEIVED'
  | 'MESSAGE_SENT'

type ActivityGoalPeriod = 'WEEKLY' | 'MONTHLY'

interface ActivityReportSummary {
  totalActivities: number
  unattributedActivities: number
  completionRate: number
  completionRateNumerator: number
  completionRateDenominator: number
  tasksCompleted: number
  avgCompletionTimeHours: number
  overdueTasks: number
  timeTrackedSeconds: number
  meetingsScheduled: number
  startDate: string
  endDate: string
  calculationNote: string
}

interface ActivityHeatmapCell {
  dayOfWeek: number
  hour: number
  count: number
}

interface ActivityLeaderboardRow {
  userId: string
  firstName: string
  lastName: string
  teamId: string | null
  activitiesLogged: number
  tasksCompleted: number
  dealsClosed: number
  timeTrackedSeconds: number
  rank: number
}

interface ActivityReport {
  summary: ActivityReportSummary
  activitiesByType: Array<{ type: string; count: number }>
  activitiesByUser: Array<{
    userId: string
    firstName: string
    lastName: string
    teamId: string | null
    count: number
  }>
  activitiesByDate: Array<{ date: string; count: number }>
  heatmap: ActivityHeatmapCell[]
  trend: Array<{ bucketStart: string; count: number }>
  leaderboard: ActivityLeaderboardRow[]
  teamComparison: Array<{
    teamId: string
    teamName: string
    totalActivities: number
    tasksCompleted: number
    avgCompletionTimeHours: number
    overdueTasks: number
    timeTrackedSeconds: number
    meetingsScheduled: number
    completionRate: number
  }>
}

interface ActivityGoalUser {
  id: string
  firstName: string
  lastName: string
}

interface ActivityGoal {
  id: string
  name: string
  activityType: ActivityTypeValue | null
  targetCount: number
  period: ActivityGoalPeriod
  userId: string
  startsOn: string
  isActive: boolean
  createdAt: string
  updatedAt: string
  qualifyingCount: number
  progress: number
  progressPercent: number
  user?: ActivityGoalUser | null
}

interface ActivityReportFilterInput {
  startDate: string
  endDate: string
  userId?: string | null
  teamId?: string | null
  comparisonTeamIds?: string[] | null
  activityTypes?: ActivityTypeValue[] | null
  contactId?: string | null
  dealId?: string | null
  bucket?: string | null
  sortBy?: string | null
}

interface MockUser {
  id: string
  firstName: string
  lastName: string
  email: string
}

interface MockTeam {
  id: string
  name: string
  managerId: string
  manager: { id: string; firstName: string; lastName: string } | null
  memberCount: number
  createdAt: string
}

type Permission = { resource: string; action: string; granted: boolean }

type MockHandler = (postData: {
  query: string
  variables?: Record<string, unknown>
}) =>
  | { data?: unknown; errors?: Array<{ message: string }> }
  | Promise<{ data?: unknown; errors?: Array<{ message: string }> }>

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USERS: MockUser[] = [
  { id: 'user-1', firstName: 'Alice', lastName: 'Johnson', email: 'alice@example.com' },
  { id: 'user-2', firstName: 'Bob', lastName: 'Smith', email: 'bob@example.com' },
  { id: 'user-3', firstName: 'Carol', lastName: 'Lee', email: 'carol@example.com' },
]

const TEAMS: MockTeam[] = [
  {
    id: 'team-1',
    name: 'Sales Team A',
    managerId: 'user-1',
    manager: { id: 'user-1', firstName: 'Alice', lastName: 'Johnson' },
    memberCount: 5,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'team-2',
    name: 'Sales Team B',
    managerId: 'user-2',
    manager: { id: 'user-2', firstName: 'Bob', lastName: 'Smith' },
    memberCount: 4,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
]

function fullPermissions(): Permission[] {
  return [
    { resource: 'REPORT', action: 'READ', granted: true },
    { resource: 'REPORT', action: 'EXPORT', granted: true },
    { resource: 'REPORT', action: 'CREATE', granted: true },
    { resource: 'REPORT', action: 'UPDATE', granted: true },
    { resource: 'REPORT', action: 'DELETE', granted: true },
    { resource: 'CONTACT', action: 'READ', granted: true },
    { resource: 'TASK', action: 'READ', granted: true },
    { resource: 'DEAL', action: 'READ', granted: true },
  ]
}

function permissionsWithout(missing: Array<{ resource: string; action: string }>): Permission[] {
  return fullPermissions().filter(
    (p) => !missing.some((m) => m.resource === p.resource && m.action === p.action),
  )
}

/** 168 cells (7 days × 24 hours), zero-filled with a few deterministic counts. */
function buildHeatmapFixture(): ActivityHeatmapCell[] {
  const cells: ActivityHeatmapCell[] = []
  for (let d = 0; d < 7; d += 1) {
    for (let h = 0; h < 24; h += 1) {
      let count = 0
      if (d === 1 && h === 9) count = 5 // Mon 09:00 UTC — 5 activities
      if (d === 2 && h === 10) count = 8 // Tue 10:00 UTC — 8 activities
      if (d === 3 && h === 14) count = 3 // Wed 14:00 UTC — 3 activities
      if (d === 4 && h === 9) count = 12 // Thu 09:00 UTC — 12 activities (max)
      cells.push({ dayOfWeek: d, hour: h, count })
    }
  }
  return cells
}

function buildPopulatedReport(): ActivityReport {
  return {
    summary: {
      totalActivities: 128,
      unattributedActivities: 2,
      completionRate: 0.75,
      completionRateNumerator: 12,
      completionRateDenominator: 16,
      tasksCompleted: 18,
      avgCompletionTimeHours: 3.0,
      overdueTasks: 5,
      timeTrackedSeconds: 127_800, // 35h 30m
      meetingsScheduled: 9,
      startDate: '2026-07-23',
      endDate: '2026-08-22',
      calculationNote: '',
    },
    activitiesByType: [
      { type: 'CALL_MADE', count: 48 },
      { type: 'EMAIL_SENT', count: 41 },
      { type: 'MEETING_SCHEDULED', count: 9 },
      { type: 'NOTE_ADDED', count: 30 },
    ],
    activitiesByUser: [
      { userId: 'user-1', firstName: 'Alice', lastName: 'Johnson', teamId: 'team-1', count: 62 },
      { userId: 'user-2', firstName: 'Bob', lastName: 'Smith', teamId: 'team-2', count: 44 },
      { userId: 'user-3', firstName: 'Carol', lastName: 'Lee', teamId: 'team-1', count: 22 },
    ],
    activitiesByDate: [
      { date: '2026-08-16', count: 14 },
      { date: '2026-08-17', count: 18 },
      { date: '2026-08-18', count: 12 },
      { date: '2026-08-19', count: 24 },
      { date: '2026-08-20', count: 21 },
      { date: '2026-08-21', count: 19 },
      { date: '2026-08-22', count: 20 },
    ],
    heatmap: buildHeatmapFixture(),
    trend: [
      { bucketStart: '2026-08-16', count: 14 },
      { bucketStart: '2026-08-17', count: 18 },
      { bucketStart: '2026-08-18', count: 12 },
      { bucketStart: '2026-08-19', count: 24 },
      { bucketStart: '2026-08-20', count: 21 },
      { bucketStart: '2026-08-21', count: 19 },
      { bucketStart: '2026-08-22', count: 20 },
    ],
    leaderboard: [
      {
        userId: 'user-1',
        firstName: 'Alice',
        lastName: 'Johnson',
        teamId: 'team-1',
        activitiesLogged: 62,
        tasksCompleted: 8,
        dealsClosed: 5,
        timeTrackedSeconds: 46_800, // 13h
        rank: 1,
      },
      {
        userId: 'user-2',
        firstName: 'Bob',
        lastName: 'Smith',
        teamId: 'team-2',
        activitiesLogged: 44,
        tasksCompleted: 6,
        dealsClosed: 3,
        timeTrackedSeconds: 32_400, // 9h
        rank: 2,
      },
      {
        userId: 'user-3',
        firstName: 'Carol',
        lastName: 'Lee',
        teamId: 'team-1',
        activitiesLogged: 22,
        tasksCompleted: 4,
        dealsClosed: 2,
        timeTrackedSeconds: 21_600, // 6h
        rank: 3,
      },
    ],
    teamComparison: [
      {
        teamId: 'team-1',
        teamName: 'Sales Team A',
        totalActivities: 84,
        tasksCompleted: 12,
        avgCompletionTimeHours: 2.5,
        overdueTasks: 3,
        timeTrackedSeconds: 68_400, // 19h
        meetingsScheduled: 5,
        completionRate: 0.8,
      },
      {
        teamId: 'team-2',
        teamName: 'Sales Team B',
        totalActivities: 44,
        tasksCompleted: 6,
        avgCompletionTimeHours: 4.0,
        overdueTasks: 2,
        timeTrackedSeconds: 32_400, // 9h
        meetingsScheduled: 4,
        completionRate: 0.67,
      },
    ],
  }
}

function buildDrillDown(userId: string, firstName: string, lastName: string) {
  return {
    user: { id: userId, firstName, lastName, teamId: 'team-1' },
    summary: {
      totalActivities: 62,
      unattributedActivities: 0,
      completionRate: 0.75,
      completionRateNumerator: 6,
      completionRateDenominator: 8,
      tasksCompleted: 8,
      avgCompletionTimeHours: 2.5,
      overdueTasks: 2,
      timeTrackedSeconds: 46_800,
      meetingsScheduled: 4,
      startDate: '2026-07-23',
      endDate: '2026-08-22',
      calculationNote: '',
    },
    activitiesByType: [
      { type: 'CALL_MADE', count: 30 },
      { type: 'EMAIL_SENT', count: 22 },
      { type: 'MEETING_SCHEDULED', count: 4 },
      { type: 'NOTE_ADDED', count: 6 },
    ],
    activitiesByDate: [
      { date: '2026-08-19', count: 12 },
      { date: '2026-08-20', count: 10 },
      { date: '2026-08-21', count: 18 },
      { date: '2026-08-22', count: 22 },
    ],
    dealsClosed: 5,
    recentActivities: {
      items: [
        {
          id: 'act-drill-1',
          type: 'CALL_MADE' as ActivityTypeValue,
          title: 'Called Nguyen Thi Mai',
          createdAt: '2026-08-22T09:30:00.000Z',
        },
        {
          id: 'act-drill-2',
          type: 'EMAIL_SENT' as ActivityTypeValue,
          title: 'Sent proposal to Global Tech',
          createdAt: '2026-08-22T08:00:00.000Z',
        },
      ],
      total: 2,
      page: 1,
      pageSize: 10,
    },
  }
}

const SEED_GOAL: ActivityGoal = {
  id: 'goal-1',
  name: '50 Calls per week',
  activityType: 'CALL_MADE',
  targetCount: 50,
  period: 'WEEKLY',
  userId: 'user-1',
  startsOn: '2026-08-19T00:00:00.000Z',
  isActive: true,
  createdAt: '2026-08-19T00:00:00.000Z',
  updatedAt: '2026-08-19T00:00:00.000Z',
  qualifyingCount: 30,
  progress: 0.6,
  progressPercent: 60,
  user: { id: 'user-1', firstName: 'Alice', lastName: 'Johnson' },
}

// ---------------------------------------------------------------------------
// Stateful Mock System
// ---------------------------------------------------------------------------

interface ActivityMockState {
  permissions?: Permission[]
  reportData?: ActivityReport
  reportError?: boolean
  reportErrorForFirstN?: number
  delayReportMs?: number
  goals?: ActivityGoal[]
  exportStatus?: 'PENDING' | 'READY' | 'FAILED'
}

function buildActivityMock(state: ActivityMockState = {}): {
  handlers: Array<[string, MockHandler]>
  capturedRequests: {
    reportFilters: ActivityReportFilterInput[]
    drillDowns: Array<{ userId: string; filters: ActivityReportFilterInput; pagination?: unknown }>
    mutations: Array<{ query: string; variables?: Record<string, unknown> }>
  }
  counters: {
    reportQueryCount: number
    drillDownCount: number
    exportMutation: number
    downloadUrl: number
  }
  goalRows: () => ActivityGoal[]
} {
  // One writer, many readers: goal CRUD mutations mutate this closure array;
  // query ActivityGoals reads it. Survives refetch after invalidate + reload.
  const goals: ActivityGoal[] = [...(state.goals ?? [SEED_GOAL])]

  const capturedRequests = {
    reportFilters: [] as ActivityReportFilterInput[],
    drillDowns: [] as Array<{
      userId: string
      filters: ActivityReportFilterInput
      pagination?: unknown
    }>,
    mutations: [] as Array<{ query: string; variables?: Record<string, unknown> }>,
  }

  const counters = {
    reportQueryCount: 0,
    drillDownCount: 0,
    exportMutation: 0,
    downloadUrl: 0,
  }

  const reportData = state.reportData ?? buildPopulatedReport()

  const handlers: Array<[string, MockHandler]> = [
    [
      'query MyPermissions',
      () => ({
        data: { myPermissions: state.permissions ?? fullPermissions() },
      }),
    ],
    [
      // AppShell hydrates the auth store via getMe() (query Me) — without it
      // the sidebar nav never authenticates and permission-gated items
      // (Reports → Activity, …) stay hidden.
      'query Me',
      () => ({
        data: {
          me: {
            id: 'user-admin-1',
            tenantId: 'tenant-e2e-1',
            email: 'admin@example.com',
            firstName: 'Acme',
            lastName: 'Admin',
            avatar: null,
            phone: null,
            jobTitle: null,
            department: null,
            roles: [{ id: 'role-admin', name: 'ADMIN' }],
            isActive: true,
            teamId: 'team-1',
            team: { id: 'team-1', name: 'Sales Team A' },
            lastLoginAt: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      }),
    ],
    [
      'query SearchUsers',
      () => ({
        data: { users: { items: USERS } },
      }),
    ],
    [
      'query Teams',
      () => ({
        data: { teams: TEAMS },
      }),
    ],
    [
      'query ActivityReport',
      (postData) => {
        counters.reportQueryCount += 1
        const filters = (postData.variables?.['filters'] ?? {}) as ActivityReportFilterInput
        capturedRequests.reportFilters.push(filters)

        const shouldError =
          state.reportError ||
          (state.reportErrorForFirstN !== undefined &&
            counters.reportQueryCount <= state.reportErrorForFirstN)
        const result = shouldError
          ? { errors: [{ message: 'Failed to fetch activity report from server' }] }
          : { data: { activityReport: reportData } }

        if (state.delayReportMs) {
          return new Promise((resolve) => {
            setTimeout(() => resolve(result), state.delayReportMs)
          })
        }
        return result
      },
    ],
    [
      'query ActivityUserDrillDown',
      (postData) => {
        counters.drillDownCount += 1
        const userId = String(postData.variables?.['userId'] ?? 'user-1')
        capturedRequests.drillDowns.push({
          userId,
          filters: (postData.variables?.['filters'] ?? {}) as ActivityReportFilterInput,
          pagination: postData.variables?.['pagination'],
        })
        const user = USERS.find((u) => u.id === userId) ?? USERS[0]!
        return {
          data: {
            activityUserDrillDown: buildDrillDown(user.id, user.firstName, user.lastName),
          },
        }
      },
    ],
    [
      'query ActivityGoals',
      () => ({
        data: {
          activityGoals: {
            items: goals,
            total: goals.length,
            page: 1,
            pageSize: 20,
          },
        },
      }),
    ],
    [
      'mutation CreateActivityGoal',
      (postData) => {
        capturedRequests.mutations.push(postData)
        const input = (postData.variables?.['input'] ?? {}) as Record<string, unknown>
        const userId = String(input['userId'] ?? 'user-1')
        const user = USERS.find((u) => u.id === userId) ?? null
        const created: ActivityGoal = {
          id: `goal-created-${goals.length + 1}`,
          name: String(input['name'] ?? ''),
          activityType: (input['activityType'] as ActivityTypeValue) ?? null,
          targetCount: Number(input['targetCount'] ?? 0),
          period: (input['period'] as ActivityGoalPeriod) ?? 'WEEKLY',
          userId,
          startsOn: String(input['startsOn'] ?? new Date().toISOString()),
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          qualifyingCount: 0,
          progress: 0,
          progressPercent: 0,
          user,
        }
        goals.push(created)
        return { data: { createActivityGoal: created } }
      },
    ],
    [
      'mutation UpdateActivityGoal',
      (postData) => {
        capturedRequests.mutations.push(postData)
        const id = String(postData.variables?.['id'] ?? '')
        const input = (postData.variables?.['input'] ?? {}) as Record<string, unknown>
        const goal = goals.find((g) => g.id === id)
        if (!goal) {
          return { errors: [{ message: 'Activity goal not found.' }] }
        }
        const updated: ActivityGoal = {
          ...goal,
          name: input['name'] !== undefined ? String(input['name']) : goal.name,
          activityType:
            input['activityType'] !== undefined
              ? (input['activityType'] as ActivityTypeValue) ?? null
              : goal.activityType,
          targetCount:
            input['targetCount'] !== undefined ? Number(input['targetCount']) : goal.targetCount,
          period: (input['period'] as ActivityGoalPeriod) ?? goal.period,
          startsOn: input['startsOn'] !== undefined ? String(input['startsOn']) : goal.startsOn,
          isActive: input['isActive'] !== undefined ? Boolean(input['isActive']) : goal.isActive,
          updatedAt: new Date().toISOString(),
        }
        const idx = goals.findIndex((g) => g.id === id)
        goals[idx] = updated
        return { data: { updateActivityGoal: updated } }
      },
    ],
    [
      'mutation DeleteActivityGoal',
      (postData) => {
        capturedRequests.mutations.push(postData)
        const id = String(postData.variables?.['id'] ?? '')
        const idx = goals.findIndex((g) => g.id === id)
        if (idx >= 0) goals.splice(idx, 1)
        return { data: { deleteActivityGoal: true } }
      },
    ],
    [
      'mutation ExportActivityReport',
      (postData) => {
        capturedRequests.mutations.push(postData)
        counters.exportMutation += 1
        const format = String(postData.variables?.['format'] ?? 'PDF')
        const status = state.exportStatus ?? 'READY'
        return {
          data: {
            exportActivityReport: {
              id: 'export-activity-1',
              sourceType: 'ACTIVITY_REPORT',
              status,
              format,
              filterSummary: '2026-07-23 → 2026-08-22',
              dateRangeStart: '2026-07-23',
              dateRangeEnd: '2026-08-22',
              filename: status === 'READY' ? 'Activity_Report.pdf' : null,
              contentType: status === 'READY' ? 'application/pdf' : null,
              fileSizeBytes: status === 'READY' ? 12_345 : null,
              attemptCount: 1,
              errorCode: null,
              errorMessage: null,
              createdAt: new Date().toISOString(),
              completedAt: status === 'READY' ? new Date().toISOString() : null,
              report: null,
            },
          },
        }
      },
    ],
    [
      'mutation ReportExportDownloadUrl',
      (postData) => {
        capturedRequests.mutations.push(postData)
        counters.downloadUrl += 1
        const id = String(postData.variables?.['id'] ?? 'unknown')
        return {
          data: {
            reportExportDownloadUrl: {
              url: `${SIGNED_URL_ORIGIN}/reports/tenant-1/user-1/${id}/Activity_Report.pdf?token=fresh-${counters.downloadUrl}-${Date.now()}`,
              expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
            },
          },
        }
      },
    ],
    [
      'mutation',
      (postData) => {
        capturedRequests.mutations.push(postData)
        return { data: {} }
      },
    ],
  ]

  return { handlers, capturedRequests, counters, goalRows: () => goals }
}

async function setupGraphqlMock(
  page: import('@playwright/test').Page,
  handlers: Array<[string, MockHandler]>,
): Promise<void> {
  await page.route('**/api/graphql', async (route) => {
    const postData = route.request().postDataJSON()
    if (!postData?.query) {
      await route.continue()
      return
    }

    for (const [matcher, handler] of handlers) {
      if (postData.query.includes(matcher)) {
        const result = await handler(postData)
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(result),
        })
        return
      }
    }

    // Fail loudly on unhandled GraphQL operations (Contract F37)
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        errors: [
          { message: `Unexpected unhandled GraphQL query: ${postData.query.slice(0, 100)}` },
        ],
      }),
    })
  })
}

/**
 * Cross-origin signed-URL route: fulfilled deterministically with a small PDF
 * body so the Blob download is real (non-empty) without touching storage.
 */
async function mockSignedUrlRoute(
  page: import('@playwright/test').Page,
  counters: { signedUrlFetch: () => number },
): Promise<void> {
  let fetches = 0
  counters.signedUrlFetch = () => fetches
  await page.route(`${SIGNED_URL_ORIGIN}/**`, async (route) => {
    fetches += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      body: Buffer.from('%PDF-1.4\n% e2e mock activity export body\n%%EOF\n'),
      headers: { 'Access-Control-Allow-Origin': '*' },
    })
  })
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

test.describe('Story 6.8 — Activity Reports & Team Productivity Metrics E2E', () => {
  test.beforeEach(async ({ context }) => {
    // Sign the cookie with the secret the running web server accepts
    // (CI-like self-contained mode — dummy secret, see skill §29).
    process.env['JWT_SECRET'] = API_JWT_SECRET
    process.env['PLAYWRIGHT_USER_ID'] = 'user-admin-1'
    process.env['PLAYWRIGHT_TENANT_ID'] = 'tenant-e2e-1'
    process.env['PLAYWRIGHT_EMAIL'] = 'admin@example.com'
    await applyAuthCookie(context)
  })

  test.afterEach(() => {
    delete process.env['JWT_SECRET']
    delete process.env['PLAYWRIGHT_USER_ID']
    delete process.env['PLAYWRIGHT_TENANT_ID']
    delete process.env['PLAYWRIGHT_EMAIL']
  })

  // -------------------------------------------------------------------------
  // E2E-AR-01 — Full dashboard (AC 6, 7, 8, 9, 11, 13, 14, 16; Contract E26)
  // -------------------------------------------------------------------------
  test('[P0] E2E-AR-01: /reports/activity renders metric cards, 7x24 heatmap with sr-only table, trend, leaderboard, team comparison, goals and export', async ({
    page,
  }) => {
    const { handlers } = buildActivityMock({})
    await setupGraphqlMock(page, handlers)
    await page.goto('/reports/activity', { timeout: 120_000 })

    // Header (AC 6)
    await expect(page.getByRole('heading', { name: 'Activity Reports', level: 1 })).toBeVisible({
      timeout: 60_000,
    })
    await expect(
      page.getByText('Team activity metrics, productivity heatmaps, goals, and leaderboard.'),
    ).toBeVisible()

    // Export trigger visible (AC 16)
    const exportTrigger = page.getByRole('button', { name: 'Export report' })
    await expect(exportTrigger).toBeVisible()
    await expect(exportTrigger).toHaveAttribute('aria-haspopup', 'menu')

    // 1. Metric cards — all 7 labels + exact values (AC 4, 5, 6)
    const kpi = page.locator('section[aria-label="Key Performance Indicators"]')
    await expect(kpi).toBeVisible()
    for (const label of [
      'Total Activities',
      'Completion Rate',
      'Tasks Completed',
      'Avg Completion Time',
      'Overdue Tasks',
      'Time Tracked',
      'Meetings Scheduled',
    ]) {
      await expect(kpi.getByText(label, { exact: true })).toBeVisible()
    }
    await expect(kpi.getByText('128', { exact: true })).toBeVisible()
    await expect(kpi.getByText('75.0%', { exact: true })).toBeVisible()
    await expect(kpi.getByText('12 / 16 due', { exact: true })).toBeVisible()
    await expect(kpi.getByText('18', { exact: true })).toBeVisible()
    await expect(kpi.getByText('3.0h', { exact: true })).toBeVisible()
    await expect(kpi.getByText('5', { exact: true })).toBeVisible()
    await expect(kpi.getByText('35h 30m', { exact: true })).toBeVisible()
    await expect(kpi.getByText('9', { exact: true })).toBeVisible()

    // 2. Goals section with progress bar + % (AC 13, 14)
    const goalsSection = page.locator('section[aria-label="Activity Goals Progress"]')
    await expect(goalsSection.getByText('Activity Goals Progress')).toBeVisible()
    await expect(goalsSection.getByText('1 target tracked', { exact: true })).toBeVisible()
    const goalCard = page.locator('[data-testid="goal-card-goal-1"]')
    await expect(goalCard).toBeVisible()
    await expect(goalCard.getByText('50 Calls per week', { exact: true })).toBeVisible()
    await expect(goalCard.getByText('30 / 50', { exact: true })).toBeVisible()
    await expect(goalCard.getByText('60%', { exact: true })).toBeVisible()
    const progressbar = goalCard.getByRole('progressbar', { name: '50 Calls per week' })
    await expect(progressbar).toBeVisible()
    await expect(progressbar).toHaveAttribute('aria-valuenow', '30')
    await expect(progressbar).toHaveAttribute('aria-valuemax', '50')

    // 3. Heatmap — 7×24 grid with role=img + sr-only table (AC 7, 8)
    const heatmap = page.locator('section[aria-label="Activity Heatmap"]')
    await expect(heatmap.getByText('Activity Intensity Heatmap')).toBeVisible()
    await expect(
      heatmap.getByRole('img', {
        name: 'Activity heatmap showing volume distribution across 7 days and 24 hours',
      }),
    ).toBeVisible()
    // Zero cells keep an empty rendered cell (no silent truncation) — a
    // populated cell exposes its count in the title tooltip (not color-only).
    await expect(heatmap.locator('[title="Mon 9:00 UTC — 5 activities"]')).toBeVisible()
    await expect(heatmap.locator('[title="Thu 9:00 UTC — 12 activities"]')).toBeVisible()
    // sr-only table equivalent: 7 rows, each with a day-name cell + 24 hours
    const srTable = heatmap.locator('div.sr-only table')
    await expect(srTable).toBeVisible()
    await expect(srTable.locator('caption')).toHaveText('Activity counts by day and hour')
    await expect(srTable.locator('tbody tr')).toHaveCount(7)
    for (let i = 0; i < 7; i += 1) {
      await expect(srTable.locator('tbody tr').nth(i).locator('td')).toHaveCount(25)
    }
    // Cell (Mon, 09:00) carries count 5 in the sr table; zero cells show 0
    // (td[0] is the day-name label, so hour h sits at td[h + 1])
    await expect(srTable.locator('tbody tr').nth(1).locator('td').nth(10)).toHaveText('5')
    await expect(srTable.locator('tbody tr').nth(0).locator('td').nth(1)).toHaveText('0')

    // 4. Trend chart section (AC 7) — "Activity Trend" also appears in the
    //    chart title + sr-only caption, so scope to the section heading role.
    const trend = page.locator('section[aria-label="Activity Trend"]')
    await expect(trend.getByRole('heading', { name: 'Activity Trend' })).toBeVisible()
    await expect(trend.locator('svg').first()).toBeVisible()

    // 5. Leaderboard — rank + 4 metric columns (AC 9)
    const leaderboard = page.locator('section[aria-label="Top Performers Leaderboard"]')
    await expect(leaderboard.getByText('Top Performers Leaderboard')).toBeVisible()
    await expect(leaderboard.getByRole('columnheader', { name: 'Rank & Member' })).toBeVisible()
    for (const col of ['Activities Logged', 'Tasks Completed', 'Deals Closed', 'Time Tracked']) {
      await expect(leaderboard.getByRole('button', { name: col, exact: true })).toBeVisible()
    }
    const row1 = page.locator('[data-testid="leaderboard-row-user-1"]')
    await expect(row1).toBeVisible()
    await expect(row1.getByText('Alice Johnson', { exact: true })).toBeVisible()
    await expect(row1.getByText('62', { exact: true })).toBeVisible()
    await expect(row1.getByText('13h', { exact: true })).toBeVisible()
    const row3 = page.locator('[data-testid="leaderboard-row-user-3"]')
    await expect(row3.getByText('Carol Lee', { exact: true })).toBeVisible()
    await expect(row3.getByText('22', { exact: true })).toBeVisible()

    // 6. Team comparison side-by-side cards (AC 11)
    const comparison = page.locator('section[aria-label="Team Comparison"]')
    await expect(comparison.getByText('Team Comparison')).toBeVisible()
    const teamA = page.locator('[data-testid="team-card-team-1"]')
    await expect(teamA).toBeVisible()
    await expect(teamA.getByRole('heading', { name: 'Sales Team A' })).toBeVisible()
    await expect(teamA.getByText('84', { exact: true })).toBeVisible()
    await expect(teamA.getByText('80.0%', { exact: true })).toBeVisible()
    await expect(teamA.getByText('19h', { exact: true })).toBeVisible()
    const teamB = page.locator('[data-testid="team-card-team-2"]')
    await expect(teamB.getByRole('heading', { name: 'Sales Team B' })).toBeVisible()
    await expect(teamB.getByText('44', { exact: true })).toBeVisible()
    await expect(teamB.getByText('67.0%', { exact: true })).toBeVisible()

    // 7. "Set Activity Target" management button visible with REPORT:CREATE (AC 13)
    await expect(page.getByRole('button', { name: 'Set Activity Target' })).toBeVisible()
  })

  // -------------------------------------------------------------------------
  // E2E-AR-02 — Navigation (AC 6; Contract E25)
  // -------------------------------------------------------------------------
  test('[P0] E2E-AR-02: nav "Activity" link and breadcrumb route to /reports/activity', async ({
    page,
  }) => {
    const { handlers } = buildActivityMock({})
    await setupGraphqlMock(page, handlers)
    await page.goto('/reports/activity', { timeout: 120_000 })

    await expect(page.getByRole('heading', { name: 'Activity Reports', level: 1 })).toBeVisible({
      timeout: 60_000,
    })

    // AppShell report navigation entry, gated on REPORT:READ (Contract E25).
    const nav = page.getByRole('navigation', { name: /crm navigation/i })
    const activityLink = nav.getByRole('link', { name: 'Activity', exact: true })
    await expect(activityLink).toBeVisible({ timeout: 30_000 })
    await expect(activityLink).toHaveAttribute('href', '/reports/activity')

    // Breadcrumb: CRM / Reports / Activity.
    const breadcrumb = page.locator('nav[aria-label="breadcrumb"]')
    await expect(breadcrumb.getByRole('link', { name: 'CRM' })).toHaveAttribute(
      'href',
      '/dashboard',
    )
    await expect(breadcrumb.getByRole('link', { name: 'Reports' })).toHaveAttribute(
      'href',
      '/reports',
    )
    await expect(breadcrumb.getByText('Activity', { exact: true })).toBeVisible()
  })

  // -------------------------------------------------------------------------
  // E2E-AR-03 — Filters (AC 10) + sortable leaderboard columns (AC 9)
  // -------------------------------------------------------------------------
  test('[P0] E2E-AR-03: filter toolbar dispatches exact variables, sort headers dispatch sortBy, Reset restores defaults, invalid ranges blocked inline', async ({
    page,
  }) => {
    const { handlers, capturedRequests } = buildActivityMock({})
    await setupGraphqlMock(page, handlers)
    await page.goto('/reports/activity', { timeout: 120_000 })

    await expect(page.getByRole('heading', { name: 'Activity Reports', level: 1 })).toBeVisible({
      timeout: 60_000,
    })

    const filters = page.locator('section[aria-label="Activity Report Filters"]')
    await expect(filters.getByText('Filter Criteria')).toBeVisible()

    // 1. Fill every filter dimension (AC 10)
    await filters.locator('#activity-start-date').fill('2026-07-01')
    await filters.locator('#activity-end-date').fill('2026-08-22')
    await filters.locator('#activity-user-select').selectOption('user-1')
    await filters.locator('#activity-team-select').selectOption('team-1')
    await filters.locator('#activity-contact-id').fill('contact-abc')
    await filters.locator('#activity-deal-id').fill('deal-xyz')
    // Activity type multi-select chip
    await filters.getByRole('button', { name: 'Email Sent', exact: true }).click()
    // Team comparison multi-select chip
    await filters.getByRole('button', { name: 'Sales Team B', exact: true }).click()

    const queriesBeforeApply = capturedRequests.reportFilters.length

    // 2. Apply → exact variables dispatched (AC 10)
    await page.getByRole('button', { name: 'Apply Filters' }).click()
    await expect
      .poll(() => capturedRequests.reportFilters[capturedRequests.reportFilters.length - 1])
      .toMatchObject({
        startDate: '2026-07-01',
        endDate: '2026-08-22',
        userId: 'user-1',
        teamId: 'team-1',
        activityTypes: ['EMAIL_SENT'],
        contactId: 'contact-abc',
        dealId: 'deal-xyz',
        comparisonTeamIds: ['team-2'],
        sortBy: 'ACTIVITIES',
        bucket: 'DAY',
      })

    // Query actually re-dispatched (not just state change)
    await expect
      .poll(() => capturedRequests.reportFilters.length)
      .toBeGreaterThan(queriesBeforeApply)

    // Polite live region announces the refresh
    await expect(page.locator('div[aria-live="polite"].sr-only').first()).toContainText(
      'Activity report updated.',
      { timeout: 15_000 },
    )

    // 3. Sortable leaderboard column header dispatches sortBy (AC 9)
    const leaderboard = page.locator('section[aria-label="Top Performers Leaderboard"]')
    await leaderboard.getByRole('button', { name: 'Tasks Completed', exact: true }).click()
    await expect
      .poll(() => capturedRequests.reportFilters[capturedRequests.reportFilters.length - 1])
      .toMatchObject({ sortBy: 'TASKS_COMPLETED' })

    // 4. Invalid range (end < start) blocked inline, no query dispatched (AC 10)
    await filters.locator('#activity-start-date').fill('2026-08-22')
    await filters.locator('#activity-end-date').fill('2026-08-21')
    const queriesBeforeInvalid = capturedRequests.reportFilters.length
    await page.getByRole('button', { name: 'Apply Filters' }).click()
    await expect(
      page.getByText('End date must be greater than or equal to start date.', { exact: true }),
    ).toBeVisible()
    expect(capturedRequests.reportFilters.length).toBe(queriesBeforeInvalid)

    // 5. Range > 366 days blocked inline
    await filters.locator('#activity-start-date').fill('2025-01-01')
    await filters.locator('#activity-end-date').fill('2026-08-22')
    await page.getByRole('button', { name: 'Apply Filters' }).click()
    await expect(
      page.getByText('Date range cannot exceed 366 days.', { exact: true }),
    ).toBeVisible()
    expect(capturedRequests.reportFilters.length).toBe(queriesBeforeInvalid)

    // 6. Reset restores defaults and clears the inline error
    await page.getByRole('button', { name: 'Reset Filters' }).click()
    await expect(
      page.getByText('Date range cannot exceed 366 days.', { exact: true }),
    ).not.toBeVisible()
    await expect(filters.locator('#activity-user-select')).toHaveValue('')
    await expect(filters.locator('#activity-team-select')).toHaveValue('')
    await expect(filters.locator('#activity-contact-id')).toHaveValue('')
    await expect(filters.locator('#activity-deal-id')).toHaveValue('')
    // Active type chips cleared
    await expect(filters.getByRole('button', { name: 'Email Sent', exact: true })).not.toHaveClass(
      /bg-indigo-600/,
    )
  })

  // -------------------------------------------------------------------------
  // E2E-AR-04 — User drill-down (AC 12)
  // -------------------------------------------------------------------------
  test('[P0] E2E-AR-04: leaderboard user drill-down opens a lazy per-user panel and closes without refetching or firing mutations', async ({
    page,
  }) => {
    const { handlers, capturedRequests, counters } = buildActivityMock({})
    await setupGraphqlMock(page, handlers)
    await page.goto('/reports/activity', { timeout: 120_000 })

    await expect(page.getByRole('heading', { name: 'Activity Reports', level: 1 })).toBeVisible({
      timeout: 60_000,
    })
    await expect(page.locator('[data-testid="leaderboard-row-user-1"]')).toBeVisible()

    // No drill-down query before the click (lazy — AC 12)
    expect(counters.drillDownCount).toBe(0)

    // 1. Click the leaderboard user's drill-down button
    await page.getByRole('button', { name: 'View drill-down for Alice Johnson' }).click()

    // 2. Panel opens with per-user breakdown (AC 12)
    const panel = page.locator('[data-testid="drill-down-panel"]')
    await expect(panel).toBeVisible()
    await expect(
      panel.getByRole('heading', { name: 'Individual Performance Drill-Down: Alice Johnson' }),
    ).toBeVisible()
    for (const stat of ['Activities Logged', 'Tasks Completed', 'Deals Closed', 'Time Tracked']) {
      await expect(panel.getByText(stat, { exact: true })).toBeVisible()
    }
    await expect(panel.getByText('62', { exact: true })).toBeVisible()
    await expect(panel.getByText('5', { exact: true })).toBeVisible()
    // Recent activities feed
    await expect(panel.getByText('Recent Activities')).toBeVisible()
    await expect(panel.getByText('Called Nguyen Thi Mai')).toBeVisible()
    await expect(panel.getByText('Sent proposal to Global Tech')).toBeVisible()

    // Query carried the subject userId + current filters + page size 10
    await expect
      .poll(() => capturedRequests.drillDowns[capturedRequests.drillDowns.length - 1])
      .toMatchObject({
        userId: 'user-1',
        pagination: { page: 1, pageSize: 10 },
      })

    const drillDownCallsAfterLoad = counters.drillDownCount

    // 3. Close the panel — no extra fetch fired (AC 12 lazy semantics)
    await panel.getByRole('button', { name: 'Close drill-down' }).click()
    await expect(panel).not.toBeVisible()
    await page.waitForTimeout(800)
    expect(counters.drillDownCount).toBe(drillDownCallsAfterLoad)

    // 4. Viewing + drill-down flow fires no mutations (AC 12, Contract E41)
    expect(capturedRequests.mutations.length).toBe(0)
  })

  // -------------------------------------------------------------------------
  // E2E-AR-05 — Activity goals lifecycle (AC 13, 14)
  // -------------------------------------------------------------------------
  test('[P0] E2E-AR-05: create a goal → progress bar + % appear; edit and delete work; empty state after deleting the last goal', async ({
    page,
  }) => {
    const { handlers, capturedRequests } = buildActivityMock({})
    await setupGraphqlMock(page, handlers)
    await page.goto('/reports/activity', { timeout: 120_000 })

    await expect(page.getByRole('heading', { name: 'Activity Reports', level: 1 })).toBeVisible({
      timeout: 60_000,
    })

    const goalsSection = page.locator('section[aria-label="Activity Goals Progress"]')

    // 1. Seed goal visible with progress (AC 14)
    await expect(goalsSection.getByText('1 target tracked', { exact: true })).toBeVisible()

    // 2. Create a goal (AC 13)
    await page.getByRole('button', { name: 'Set Activity Target' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Create Activity Goal' })).toBeVisible()
    await dialog.getByLabel(/Goal Name/).fill('E2E 50 Calls per week')
    await dialog.getByLabel(/Target Count/).fill('50')
    await dialog.getByLabel(/Period/).selectOption('WEEKLY')
    await dialog.getByLabel(/Assignee/).selectOption('user-2')
    await dialog.getByLabel(/Starts On/).fill('2026-08-22')
    await dialog.getByRole('button', { name: 'Create Goal' }).click()

    // Mutation dispatched with the exact input
    await expect
      .poll(() => capturedRequests.mutations[capturedRequests.mutations.length - 1])
      .toMatchObject({
        query: expect.stringContaining('CreateActivityGoal'),
        variables: {
          input: {
            name: 'E2E 50 Calls per week',
            targetCount: 50,
            period: 'WEEKLY',
            userId: 'user-2',
          },
        },
      })

    // New goal card with progress bar + % (server-computed fixture: 0/50, 0%)
    const newCard = page.locator('[data-testid="goal-card-goal-created-2"]')
    await expect(newCard).toBeVisible({ timeout: 15_000 })
    await expect(newCard.getByText('E2E 50 Calls per week', { exact: true })).toBeVisible()
    await expect(newCard.getByText('0 / 50', { exact: true })).toBeVisible()
    await expect(newCard.getByText('0%', { exact: true })).toBeVisible()
    const newBar = newCard.getByRole('progressbar', { name: 'E2E 50 Calls per week' })
    await expect(newBar).toHaveAttribute('aria-valuenow', '0')
    await expect(newBar).toHaveAttribute('aria-valuemax', '50')
    // List counter updates via query invalidation
    await expect(goalsSection.getByText('2 targets tracked', { exact: true })).toBeVisible()

    // 3. Edit the goal (AC 13)
    await page.getByRole('button', { name: 'Edit E2E 50 Calls per week' }).click()
    await expect(dialog.getByRole('heading', { name: 'Edit Activity Goal' })).toBeVisible({
      timeout: 10_000,
    })
    const nameInput = dialog.getByLabel(/Goal Name/)
    await nameInput.fill('E2E 75 Calls per week')
    await dialog.getByLabel(/Target Count/).fill('75')
    await dialog.getByRole('button', { name: 'Update Goal' }).click()
    await expect
      .poll(() => capturedRequests.mutations[capturedRequests.mutations.length - 1])
      .toMatchObject({
        query: expect.stringContaining('UpdateActivityGoal'),
        variables: { id: 'goal-created-2' },
      })
    const editedCard = page.locator('[data-testid="goal-card-goal-created-2"]')
    await expect(editedCard.getByText('E2E 75 Calls per week', { exact: true })).toBeVisible({
      timeout: 15_000,
    })
    await expect(editedCard.getByText('0 / 75', { exact: true })).toBeVisible()

    // 4. Delete the seeded goal → then the created one → empty state (AC 13)
    await page.getByRole('button', { name: 'Delete 50 Calls per week' }).click()
    const confirmDialog = page.getByRole('dialog')
    await expect(confirmDialog.getByRole('heading', { name: 'Delete Activity Goal' })).toBeVisible()
    await confirmDialog.getByRole('button', { name: 'Delete Goal' }).click()
    await expect(page.locator('[data-testid="goal-card-goal-1"]')).not.toBeVisible({
      timeout: 15_000,
    })

    await page.getByRole('button', { name: 'Delete E2E 75 Calls per week' }).click()
    await page.getByRole('button', { name: 'Delete Goal' }).click()
    await expect(goalsSection.getByText('No activity targets configured yet.')).toBeVisible({
      timeout: 15_000,
    })
  })

  // -------------------------------------------------------------------------
  // E2E-AR-06 — Export (AC 16)
  // -------------------------------------------------------------------------
  test('[P0] E2E-AR-06: export menu shows PDF/EXCEL only (no CSV), dispatches ExportActivityReport with filters, and READY downloads the exact filename', async ({
    page,
  }) => {
    const { handlers, capturedRequests, counters } = buildActivityMock({})
    const signedCounters = { signedUrlFetch: () => 0 }
    await setupGraphqlMock(page, handlers)
    await mockSignedUrlRoute(page, signedCounters)

    await page.goto('/reports/activity', { timeout: 120_000 })
    await expect(page.getByRole('heading', { name: 'Activity Reports', level: 1 })).toBeVisible({
      timeout: 60_000,
    })

    const exportTrigger = page.getByRole('button', { name: 'Export report' })
    await expect(exportTrigger).toBeVisible()
    await expect(exportTrigger).toHaveAttribute('aria-expanded', 'false')

    // 1. Menu exposes exactly PDF + Excel — CSV is NOT offered for activity (AC 16)
    await exportTrigger.click()
    await expect(exportTrigger).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('menu', { name: 'Export formats' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /PDF Document/ })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /Excel \(\.xlsx\)/ })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /CSV Plain/ })).not.toBeVisible()
    await expect(page.getByRole('menuitem')).toHaveCount(2)

    // 2. PDF → durable export → READY → fresh signed URL → real download
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('menuitem', { name: /PDF Document/ }).click()
    const download = await downloadPromise
    await expect.poll(() => counters.exportMutation).toBe(1)
    expect(download.suggestedFilename()).toBe('Activity_Report.pdf')
    await expect.poll(() => counters.downloadUrl).toBe(1)
    expect(signedCounters.signedUrlFetch()).toBe(1)

    // 3. Mutation carried filters + format (AC 16, Contract E30)
    const exportMutation = capturedRequests.mutations.find((m) =>
      m.query.includes('ExportActivityReport'),
    )
    expect(exportMutation).toBeTruthy()
    expect(exportMutation!.variables).toMatchObject({
      format: 'PDF',
      filters: {
        startDate: expect.any(String),
        endDate: expect.any(String),
        sortBy: 'ACTIVITIES',
        bucket: 'DAY',
      },
    })
  })

  // -------------------------------------------------------------------------
  // E2E-AR-07 — Permission gating (AC 6; Contract E25/E30)
  // -------------------------------------------------------------------------
  test('[P1] E2E-AR-07: permission denied when a required READ is missing; export disabled without REPORT:EXPORT', async ({
    page,
  }) => {
    // 1. Missing TASK:READ → PermissionLimitedState (route-level, not just hidden nav)
    const denied = buildActivityMock({
      permissions: permissionsWithout([{ resource: 'TASK', action: 'READ' }]),
    })
    await setupGraphqlMock(page, denied.handlers)
    await page.goto('/reports/activity', { timeout: 120_000 })

    await expect(page.getByText('Truy cập bị giới hạn quyền')).toBeVisible({ timeout: 60_000 })
    await expect(
      page.getByText(
        'Yêu cầu đồng thời các quyền: REPORT:READ, CONTACT:READ, TASK:READ và DEAL:READ để xem báo cáo hoạt động.',
        { exact: true },
      ),
    ).toBeVisible()
    await expect(page.locator('section[aria-label="Key Performance Indicators"]')).not.toBeVisible()
    // Overview query must not fire without full read access
    expect(denied.counters.reportQueryCount).toBe(0)

    // 2. Full READ but no REPORT:EXPORT / REPORT:CREATE → dashboard renders,
    //    export disabled, goal management UI hidden
    const noExport = buildActivityMock({
      permissions: permissionsWithout([
        { resource: 'REPORT', action: 'EXPORT' },
        { resource: 'REPORT', action: 'CREATE' },
      ]),
    })
    await setupGraphqlMock(page, noExport.handlers)
    await page.goto('/reports/activity', { timeout: 120_000 })
    await expect(page.getByRole('heading', { name: 'Activity Reports', level: 1 })).toBeVisible({
      timeout: 60_000,
    })
    await expect(page.locator('section[aria-label="Key Performance Indicators"]')).toBeVisible()

    const exportTrigger = page.getByRole('button', { name: 'Export report' })
    await expect(exportTrigger).toBeDisabled()
    await expect(
      page.locator('div[title="You do not have permission to export reports."]'),
    ).toBeVisible()
    await expect(page.getByText('You do not have permission to export reports.')).toBeVisible()

    // Goal CUD buttons also hidden without REPORT:CREATE
    await expect(page.getByRole('button', { name: 'Set Activity Target' })).not.toBeVisible()
  })

  // -------------------------------------------------------------------------
  // E2E-AR-08 — Error + empty states (AC 6)
  // -------------------------------------------------------------------------
  test('[P1] E2E-AR-08: server error shows ErrorState and recovers via Try again; empty data shows EmptyState', async ({
    page,
  }) => {
    // 1. Error state — TanStack retries 3x, so error the first 4 calls
    const errorState = buildActivityMock({ reportErrorForFirstN: 4 })
    await setupGraphqlMock(page, errorState.handlers)
    await page.goto('/reports/activity', { timeout: 120_000 })

    await expect(page.getByText('Could not load activity report')).toBeVisible({
      timeout: 30_000,
    })
    const retryBtn = page.getByRole('button', { name: 'Try again' })
    await expect(retryBtn).toBeVisible()
    await retryBtn.click()
    await expect(page.locator('section[aria-label="Key Performance Indicators"]')).toBeVisible({
      timeout: 20_000,
    })

    // 2. Empty state (zero activities in range)
    const emptyReport = buildPopulatedReport()
    emptyReport.summary.totalActivities = 0
    const emptyState = buildActivityMock({ reportData: emptyReport })
    await setupGraphqlMock(page, emptyState.handlers)
    await page.goto('/reports/activity', { timeout: 120_000 })
    await expect(page.getByText('No activities found', { exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await expect(
      page.getByText(
        'There are no logged activities or tasks matching the selected filters and date range.',
        { exact: true },
      ),
    ).toBeVisible()
  })

  // -------------------------------------------------------------------------
  // E2E-AR-09 — Mobile 320px (Contract E29/B17; E2E-6)
  // -------------------------------------------------------------------------
  test.describe('Mobile 320px viewport', () => {
    test.use({ viewport: { width: 320, height: 640 } })

    test('[P1] E2E-AR-09: 320px has no horizontal overflow, table scroll wrapper, touch targets >=44px, and dashboard sections intact', async ({
      page,
    }) => {
      const { handlers } = buildActivityMock({})
      await setupGraphqlMock(page, handlers)
      await page.goto('/reports/activity', { timeout: 120_000 })

      await expect(page.getByRole('heading', { name: 'Activity Reports', level: 1 })).toBeVisible({
        timeout: 60_000,
      })
      await expect(page.locator('section[aria-label="Key Performance Indicators"]')).toBeVisible()

      // 1. No document-level horizontal overflow
      const documentOverflows = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth
      })
      expect(documentOverflows).toBe(false)

      // 2. Heatmap + leaderboard contained in scroll wrappers (no page overflow)
      await expect(
        page.locator('section[aria-label="Activity Heatmap"] div[role="img"]'),
      ).toBeVisible()
      await expect(page.locator('div.overflow-x-auto').first()).toBeVisible()

      // 3. Representative touch targets >= 44px
      const exportBtn = page.getByRole('button', { name: 'Export report' })
      const exportBox = await exportBtn.boundingBox()
      expect(exportBox).toBeTruthy()
      expect(exportBox!.height).toBeGreaterThanOrEqual(44)

      const applyBtn = page.getByRole('button', { name: 'Apply Filters' })
      const applyBox = await applyBtn.boundingBox()
      expect(applyBox).toBeTruthy()
      expect(applyBox!.height).toBeGreaterThanOrEqual(44)

      // 4. sr-only heatmap table still present for accessibility
      await expect(
        page.locator('section[aria-label="Activity Heatmap"] div.sr-only table tbody tr'),
      ).toHaveCount(7)
    })
  })

  // -------------------------------------------------------------------------
  // E2E-AR-10 — Loading skeleton (AC 6)
  // -------------------------------------------------------------------------
  test('[P1] E2E-AR-10: loading skeleton renders while the overview query is in flight, then the dashboard appears', async ({
    page,
  }) => {
    const { handlers } = buildActivityMock({ delayReportMs: 1500 })
    await setupGraphqlMock(page, handlers)
    await page.goto('/reports/activity', { timeout: 120_000 })

    // Skeleton while fetching
    await expect(page.locator('[data-testid="activity-report-skeleton"]')).toBeVisible({
      timeout: 30_000,
    })
    // Dashboard after load
    await expect(page.locator('section[aria-label="Key Performance Indicators"]')).toBeVisible({
      timeout: 20_000,
    })
  })
})
