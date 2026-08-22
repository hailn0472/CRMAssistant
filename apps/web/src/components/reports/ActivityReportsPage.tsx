'use client'

import React, { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarDays,
  Filter,
  Plus,
  Target,
  TrendingUp,
  Users,
  X,
  AlertTriangle,
  Award,
  ChevronRight,
  Flame,
  Pencil,
  Trash2,
} from 'lucide-react'
import toast from 'react-hot-toast'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  PermissionLimitedState,
} from '@/components/shared'
import { ResponsiveTableWrapper } from '@/components/shared/ResponsiveTableWrapper'
import { useMyPermissions } from '@/hooks/usePermission'
import { ExportReportMenu } from '@/components/reports/ExportReportMenu'
import { ActivityGoalDialog } from '@/components/reports/ActivityGoalDialog'
import { ReportChart } from '@/components/reports/charting/ReportChart'
import {
  activityReportKeys,
  deleteActivityGoal,
  getActivityGoals,
  getActivityReport,
  getActivityUserDrillDown,
  type ActivityGoal,
  type ActivityReportFilterInput,
  type ActivityReportSortBy,
} from '@/services/activity-report.service'
import { exportActivityReport } from '@/services/report-export.service'
import { searchUsers } from '@/services/owner.service'
import { getTeams } from '@/services/team.service'
import {
  buildActivityTrendChartData,
  buildHeatmapMatrix,
  DAY_NAMES,
  formatCompletionRate,
  formatDurationHours,
  formatDurationSeconds,
  getHeatmapCellColor,
  validateActivityReportFilterRange,
} from '@/lib/activity-report'
import { ACTIVITY_TYPE_LABELS, type ActivityTypeValue } from '@/types/activity.types'

export function ActivityReportsPage(): React.JSX.Element {
  const queryClient = useQueryClient()
  const { hasPermission, isLoading: isPermissionLoading } = useMyPermissions()

  // Contract C11/E25: overview requires REPORT/CONTACT/TASK/DEAL READ
  const canReadReport = hasPermission('REPORT', 'READ')
  const canReadContact = hasPermission('CONTACT', 'READ')
  const canReadTask = hasPermission('TASK', 'READ')
  const canReadDeal = hasPermission('DEAL', 'READ')
  const hasOverviewAccess = canReadReport && canReadContact && canReadTask && canReadDeal

  // Export gate
  const canExportReport = hasPermission('REPORT', 'EXPORT')

  // Goal CUD gates
  const canCreateGoal = hasPermission('REPORT', 'CREATE')
  const canUpdateGoal = hasPermission('REPORT', 'UPDATE')
  const canDeleteGoal = hasPermission('REPORT', 'DELETE')

  // ─── Filter state ─────────────────────────────────────────────────────────
  const defaultStartDate = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d.toISOString().split('T')[0]
  }, [])
  const defaultEndDate = useMemo(() => new Date().toISOString().split('T')[0], [])

  const [startDateInput, setStartDateInput] = useState(defaultStartDate)
  const [endDateInput, setEndDateInput] = useState(defaultEndDate)
  const [selectedUserId, setSelectedUserId] = useState<string>('')
  const [selectedTeamId, setSelectedTeamId] = useState<string>('')
  const [selectedComparisonTeamIds, setSelectedComparisonTeamIds] = useState<string[]>([])
  const [selectedTypes, setSelectedTypes] = useState<ActivityTypeValue[]>([])
  const [contactIdInput, setContactIdInput] = useState('')
  const [dealIdInput, setDealIdInput] = useState('')
  const [sortBy, setSortBy] = useState<ActivityReportSortBy>('ACTIVITIES')
  const [filterValidationError, setFilterValidationError] = useState<string | null>(null)

  // Applied query filters
  const [appliedFilters, setAppliedFilters] = useState<ActivityReportFilterInput>({
    startDate: defaultStartDate,
    endDate: defaultEndDate,
    userId: null,
    teamId: null,
    comparisonTeamIds: null,
    activityTypes: null,
    contactId: null,
    dealId: null,
    sortBy: 'ACTIVITIES',
    bucket: 'DAY',
  })

  // ─── Goal dialog & Delete state ───────────────────────────────────────────
  const [goalDialogOpen, setGoalDialogOpen] = useState(false)
  const [editingGoal, setEditingGoal] = useState<ActivityGoal | null>(null)
  const [deletingGoalId, setDeletingGoalId] = useState<string | null>(null)

  // ─── Drill-down state ─────────────────────────────────────────────────────
  const [drillDownUserId, setDrillDownUserId] = useState<string | null>(null)
  const [drillDownPage, setDrillDownPage] = useState(1)

  // ─── Auxiliary queries (Users / Teams for filter pickers) ─────────────────
  const usersQuery = useQuery({
    queryKey: ['users', 'search', ''],
    queryFn: () => searchUsers(''),
    enabled: hasOverviewAccess,
    staleTime: 5 * 60 * 1000,
  })

  const teamsQuery = useQuery({
    queryKey: ['teams'],
    queryFn: () => getTeams(),
    enabled: hasOverviewAccess,
    staleTime: 5 * 60 * 1000,
  })

  const usersList = usersQuery.data ?? []
  const teamsList = teamsQuery.data ?? []

  // ─── Main Overview Query ──────────────────────────────────────────────────
  const reportQuery = useQuery({
    queryKey: activityReportKeys.overview(appliedFilters),
    queryFn: () => getActivityReport(appliedFilters),
    enabled: hasOverviewAccess,
    staleTime: 60 * 1000,
  })

  // ─── Goals Query ──────────────────────────────────────────────────────────
  const goalsQuery = useQuery({
    queryKey: activityReportKeys.goals({ activeOnly: false }),
    queryFn: () => getActivityGoals({ activeOnly: false }),
    enabled: canReadReport,
  })

  // ─── Drill-Down Query (Lazy) ──────────────────────────────────────────────
  const drillDownQuery = useQuery({
    queryKey: drillDownUserId
      ? activityReportKeys.drillDown(drillDownUserId, appliedFilters, {
          page: drillDownPage,
          pageSize: 10,
        })
      : ['activityReport', 'drillDown', 'none'],
    queryFn: () =>
      drillDownUserId
        ? getActivityUserDrillDown(drillDownUserId, appliedFilters, {
            page: drillDownPage,
            pageSize: 10,
          })
        : Promise.reject(new Error('No user selected')),
    enabled: Boolean(drillDownUserId && hasOverviewAccess),
  })

  // ─── Goal Delete Mutation ─────────────────────────────────────────────────
  const deleteGoalMutation = useMutation({
    mutationFn: (id: string) => deleteActivityGoal(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: activityReportKeys.all })
      toast.success('Activity goal deleted')
      setDeletingGoalId(null)
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to delete activity goal')
    },
  })

  // ─── Filter Handlers ──────────────────────────────────────────────────────
  const handleApplyFilters = (): void => {
    const err = validateActivityReportFilterRange({
      startDate: startDateInput,
      endDate: endDateInput,
    })
    if (err) {
      setFilterValidationError(err)
      return
    }

    setFilterValidationError(null)
    setDrillDownUserId(null)
    setAppliedFilters({
      startDate: startDateInput,
      endDate: endDateInput,
      userId: selectedUserId || null,
      teamId: selectedTeamId || null,
      comparisonTeamIds: selectedComparisonTeamIds.length > 0 ? selectedComparisonTeamIds : null,
      activityTypes: selectedTypes.length > 0 ? selectedTypes : null,
      contactId: contactIdInput.trim() || null,
      dealId: dealIdInput.trim() || null,
      sortBy,
      bucket: 'DAY',
    })
  }

  const handleResetFilters = (): void => {
    setStartDateInput(defaultStartDate)
    setEndDateInput(defaultEndDate)
    setSelectedUserId('')
    setSelectedTeamId('')
    setSelectedComparisonTeamIds([])
    setSelectedTypes([])
    setContactIdInput('')
    setDealIdInput('')
    setSortBy('ACTIVITIES')
    setFilterValidationError(null)
    setDrillDownUserId(null)

    setAppliedFilters({
      startDate: defaultStartDate,
      endDate: defaultEndDate,
      userId: null,
      teamId: null,
      comparisonTeamIds: null,
      activityTypes: null,
      contactId: null,
      dealId: null,
      sortBy: 'ACTIVITIES',
      bucket: 'DAY',
    })
  }

  const toggleActivityType = (type: ActivityTypeValue) => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    )
  }

  const toggleComparisonTeam = (teamId: string) => {
    setSelectedComparisonTeamIds((prev) => {
      if (prev.includes(teamId)) {
        return prev.filter((id) => id !== teamId)
      }
      if (prev.length >= 4) {
        toast.error('You can compare up to 4 teams at once')
        return prev
      }
      return [...prev, teamId]
    })
  }

  // ─── Permission Loading Gate ──────────────────────────────────────────────
  if (isPermissionLoading) {
    return (
      <div data-testid="activity-report-loading-skeleton" className="space-y-6 p-4 sm:p-6 lg:p-8">
        <LoadingSkeleton />
      </div>
    )
  }

  // ─── Permission Denied Gate ───────────────────────────────────────────────
  if (!hasOverviewAccess) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <PermissionLimitedState
          title="Truy cập bị giới hạn quyền"
          message="Yêu cầu đồng thời các quyền: REPORT:READ, CONTACT:READ, TASK:READ và DEAL:READ để xem báo cáo hoạt động."
        />
      </div>
    )
  }

  const data = reportQuery.data
  const summary = data?.summary
  const heatmapCells = data?.heatmap ?? []
  const maxHeatmapCount = Math.max(...heatmapCells.map((c) => c.count), 0)
  const heatmapMatrix = buildHeatmapMatrix(heatmapCells)
  const trendChartData = data?.trend ? buildActivityTrendChartData(data.trend) : null
  const leaderboardRows = data?.leaderboard ?? []
  const teamComparisonRows = data?.teamComparison ?? []
  const goals = goalsQuery.data?.items ?? []

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-6 p-4 sm:p-6 lg:p-8">
      {/* Live Region for Screen Readers */}
      <div aria-live="polite" className="sr-only">
        {reportQuery.isFetching ? 'Refreshing activity reports...' : 'Activity report updated.'}
      </div>

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#1b1b1f]">Activity Reports</h1>
          <p className="text-sm text-[#77777f]">
            Team activity metrics, productivity heatmaps, goals, and leaderboard.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <ExportReportMenu
            onExport={(format) => exportActivityReport(appliedFilters, format)}
            supportedFormats={['PDF', 'EXCEL']}
            reportName="Activity_Report"
            disabled={!canExportReport}
            disabledReason={
              !canExportReport ? 'You do not have permission to export reports.' : undefined
            }
          />
          {canCreateGoal && (
            <Button
              type="button"
              onClick={() => {
                setEditingGoal(null)
                setGoalDialogOpen(true)
              }}
              className="min-h-[44px] gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium"
            >
              <Plus className="h-4 w-4" />
              Set Activity Target
            </Button>
          )}
        </div>
      </div>

      {/* Filter Toolbar (Contract E28) */}
      <section
        aria-label="Activity Report Filters"
        className="rounded-2xl border border-[#ececf0] bg-white p-4 shadow-sm space-y-4"
      >
        <div className="flex items-center justify-between border-b border-[#ececf0] pb-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#1b1b1f]">
            <Filter className="h-4 w-4 text-indigo-600" />
            <span>Filter Criteria</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleResetFilters}
            className="min-h-[44px] text-xs text-[#77777f] hover:text-[#1b1b1f]"
          >
            Reset Filters
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          {/* Start Date */}
          <div className="space-y-1">
            <label htmlFor="activity-start-date" className="text-[11px] font-medium text-[#77777f]">
              Start Date *
            </label>
            <Input
              id="activity-start-date"
              type="date"
              value={startDateInput}
              onChange={(e) => setStartDateInput(e.target.value)}
              className="h-9 text-xs"
            />
          </div>

          {/* End Date */}
          <div className="space-y-1">
            <label htmlFor="activity-end-date" className="text-[11px] font-medium text-[#77777f]">
              End Date *
            </label>
            <Input
              id="activity-end-date"
              type="date"
              value={endDateInput}
              onChange={(e) => setEndDateInput(e.target.value)}
              className="h-9 text-xs"
            />
          </div>

          {/* User Scope */}
          <div className="space-y-1">
            <label
              htmlFor="activity-user-select"
              className="text-[11px] font-medium text-[#77777f]"
            >
              Team Member
            </label>
            <select
              id="activity-user-select"
              aria-label="Team Member"
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="w-full h-9 rounded-md border border-[#e6e6eb] bg-white px-2.5 text-xs text-[#1b1b1f] focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="">All Members</option>
              {usersList.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.firstName} {u.lastName}
                </option>
              ))}
            </select>
          </div>

          {/* Team Scope */}
          <div className="space-y-1">
            <label
              htmlFor="activity-team-select"
              className="text-[11px] font-medium text-[#77777f]"
            >
              Team
            </label>
            <select
              id="activity-team-select"
              aria-label="Team"
              value={selectedTeamId}
              onChange={(e) => setSelectedTeamId(e.target.value)}
              className="w-full h-9 rounded-md border border-[#e6e6eb] bg-white px-2.5 text-xs text-[#1b1b1f] focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="">All Teams</option>
              {teamsList.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          {/* Contact ID */}
          <div className="space-y-1">
            <label htmlFor="activity-contact-id" className="text-[11px] font-medium text-[#77777f]">
              Contact ID
            </label>
            <Input
              id="activity-contact-id"
              value={contactIdInput}
              onChange={(e) => setContactIdInput(e.target.value)}
              placeholder="Contact UUID"
              className="h-9 text-xs"
            />
          </div>

          {/* Deal ID */}
          <div className="space-y-1">
            <label htmlFor="activity-deal-id" className="text-[11px] font-medium text-[#77777f]">
              Deal ID
            </label>
            <Input
              id="activity-deal-id"
              value={dealIdInput}
              onChange={(e) => setDealIdInput(e.target.value)}
              placeholder="Deal UUID"
              className="h-9 text-xs"
            />
          </div>
        </div>

        {/* Team Comparison Multi-select */}
        {teamsList.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-[#77777f]">
                Compare Teams (Multi-select, max 4)
              </span>
              {selectedComparisonTeamIds.length > 0 && (
                <span className="text-[10px] text-indigo-600 font-medium">
                  {selectedComparisonTeamIds.length} / 4 selected
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {teamsList.map((team) => {
                const active = selectedComparisonTeamIds.includes(team.id)
                return (
                  <button
                    key={team.id}
                    type="button"
                    onClick={() => toggleComparisonTeam(team.id)}
                    className={`min-h-[32px] rounded-full px-2.5 text-[11px] font-medium transition-colors border ${
                      active
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-[#fafafb] text-[#4b4b55] border-[#e6e6eb] hover:bg-[#f4f4f6]'
                    }`}
                  >
                    {team.name}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Multi-type Selection Chips */}
        <div className="space-y-1.5 pt-1">
          <span className="text-[11px] font-medium text-[#77777f]">
            Activity Types (Multi-select)
          </span>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(ACTIVITY_TYPE_LABELS).map(([typeKey, label]) => {
              const active = selectedTypes.includes(typeKey as ActivityTypeValue)
              return (
                <button
                  key={typeKey}
                  type="button"
                  onClick={() => toggleActivityType(typeKey as ActivityTypeValue)}
                  className={`min-h-[32px] rounded-full px-2.5 text-[11px] font-medium transition-colors border ${
                    active
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-[#fafafb] text-[#4b4b55] border-[#e6e6eb] hover:bg-[#f4f4f6]'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        {filterValidationError && (
          <div className="rounded-lg bg-red-50 p-2.5 text-xs text-red-600 flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{filterValidationError}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#ececf0]">
          <Button
            type="button"
            onClick={handleApplyFilters}
            className="min-h-[44px] bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-6 font-medium"
          >
            Apply Filters
          </Button>
        </div>
      </section>

      {/* Main Content Area: Loading / Error / Empty / Dashboard */}
      {reportQuery.isLoading ? (
        <div data-testid="activity-report-skeleton" className="space-y-6">
          <LoadingSkeleton />
        </div>
      ) : reportQuery.isError ? (
        <ErrorState
          title="Could not load activity report"
          message={(reportQuery.error as Error).message || 'Failed to retrieve activity data.'}
          onRetry={() => reportQuery.refetch()}
        />
      ) : !data || summary?.totalActivities === 0 ? (
        <EmptyState
          icon={<CalendarDays className="h-6 w-6" />}
          title="No activities found"
          description="There are no logged activities or tasks matching the selected filters and date range."
        />
      ) : (
        <div className="space-y-8">
          {/* 1. Metric Cards (7) */}
          <section aria-label="Key Performance Indicators">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
              <div className="rounded-2xl border border-[#ececf0] bg-white p-4 shadow-sm flex flex-col justify-between">
                <span className="text-[11px] font-medium text-[#77777f]">Total Activities</span>
                <span className="text-xl font-bold text-[#1b1b1f] mt-2">
                  {summary?.totalActivities ?? 0}
                </span>
                <span className="text-[10px] text-[#8c8c96] mt-1">Logged in period</span>
              </div>

              <div className="rounded-2xl border border-[#ececf0] bg-white p-4 shadow-sm flex flex-col justify-between">
                <span className="text-[11px] font-medium text-[#77777f]">Completion Rate</span>
                <span className="text-xl font-bold text-emerald-600 mt-2">
                  {formatCompletionRate(summary?.completionRate ?? 0)}
                </span>
                <span className="text-[10px] text-[#8c8c96] mt-1">
                  {summary?.completionRateNumerator ?? 0} /{' '}
                  {summary?.completionRateDenominator ?? 0} due
                </span>
              </div>

              <div className="rounded-2xl border border-[#ececf0] bg-white p-4 shadow-sm flex flex-col justify-between">
                <span className="text-[11px] font-medium text-[#77777f]">Tasks Completed</span>
                <span className="text-xl font-bold text-[#1b1b1f] mt-2">
                  {summary?.tasksCompleted ?? 0}
                </span>
                <span className="text-[10px] text-[#8c8c96] mt-1">Completed in range</span>
              </div>

              <div className="rounded-2xl border border-[#ececf0] bg-white p-4 shadow-sm flex flex-col justify-between">
                <span className="text-[11px] font-medium text-[#77777f]">Avg Completion Time</span>
                <span className="text-xl font-bold text-[#1b1b1f] mt-2">
                  {formatDurationHours(summary?.avgCompletionTimeHours ?? 0)}
                </span>
                <span className="text-[10px] text-[#8c8c96] mt-1">From creation</span>
              </div>

              <div className="rounded-2xl border border-[#ececf0] bg-white p-4 shadow-sm flex flex-col justify-between">
                <span className="text-[11px] font-medium text-[#77777f]">Overdue Tasks</span>
                <span className="text-xl font-bold text-red-600 mt-2">
                  {summary?.overdueTasks ?? 0}
                </span>
                <span className="text-[10px] text-[#8c8c96] mt-1">Due before now</span>
              </div>

              <div className="rounded-2xl border border-[#ececf0] bg-white p-4 shadow-sm flex flex-col justify-between">
                <span className="text-[11px] font-medium text-[#77777f]">Time Tracked</span>
                <span className="text-xl font-bold text-[#1b1b1f] mt-2">
                  {formatDurationSeconds(summary?.timeTrackedSeconds ?? 0)}
                </span>
                <span className="text-[10px] text-[#8c8c96] mt-1">Non-running timers</span>
              </div>

              <div className="rounded-2xl border border-[#ececf0] bg-white p-4 shadow-sm flex flex-col justify-between">
                <span className="text-[11px] font-medium text-[#77777f]">Meetings Scheduled</span>
                <span className="text-xl font-bold text-indigo-600 mt-2">
                  {summary?.meetingsScheduled ?? 0}
                </span>
                <span className="text-[10px] text-[#8c8c96] mt-1">Calendar events</span>
              </div>
            </div>
          </section>

          {/* 2. Activity Goals Progress Section (Contract D17-D18) */}
          <section aria-label="Activity Goals Progress" className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target className="h-5 w-5 text-indigo-600" />
                <h2 className="text-base font-semibold text-[#1b1b1f]">Activity Goals Progress</h2>
              </div>
              <span className="text-xs text-[#77777f]">
                {goals.length} target{goals.length === 1 ? '' : 's'} tracked
              </span>
            </div>

            {goals.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#e6e6eb] bg-[#fafafb] p-6 text-center text-xs text-[#77777f]">
                No activity targets configured yet.{' '}
                {canCreateGoal ? 'Click "Set Activity Target" to add one.' : ''}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {goals.map((g) => {
                  const progressPct = Math.min(g.progressPercent, 100)
                  return (
                    <div
                      key={g.id}
                      data-testid={`goal-card-${g.id}`}
                      className="rounded-2xl border border-[#ececf0] bg-white p-4 shadow-sm space-y-3 flex flex-col justify-between"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-xs text-[#1b1b1f]">{g.name}</p>
                          <p className="text-[11px] text-[#8c8c96]">
                            {g.user ? `${g.user.firstName} ${g.user.lastName}` : 'Unassigned'} •{' '}
                            {g.period.toLowerCase()}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          {canUpdateGoal && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={`Edit ${g.name}`}
                              onClick={() => {
                                setEditingGoal(g)
                                setGoalDialogOpen(true)
                              }}
                              className="min-h-[44px] min-w-[44px] p-1 text-[#77777f] hover:text-[#1b1b1f]"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {canDeleteGoal && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={`Delete ${g.name}`}
                              onClick={() => setDeletingGoalId(g.id)}
                              className="min-h-[44px] min-w-[44px] p-1 text-[#77777f] hover:text-red-600"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex justify-between text-xs">
                          <span className="font-medium text-[#4b4b55]">
                            {g.qualifyingCount} / {g.targetCount}
                          </span>
                          <span className="font-bold text-indigo-600">{g.progressPercent}%</span>
                        </div>
                        <div
                          role="progressbar"
                          aria-valuenow={g.qualifyingCount}
                          aria-valuemin={0}
                          aria-valuemax={g.targetCount}
                          aria-label={g.name}
                          className="h-2 w-full rounded-full bg-[#ececf0] overflow-hidden"
                        >
                          <div
                            style={{ width: `${progressPct}%` }}
                            className={`h-full transition-all duration-300 ${
                              progressPct >= 100 ? 'bg-emerald-500' : 'bg-indigo-600'
                            }`}
                          />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* 3. Heatmap Grid (7x24) + SR-Only Table (Contract E26/E29) */}
          <section aria-label="Activity Heatmap" className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Flame className="h-5 w-5 text-amber-600" />
                <h2 className="text-base font-semibold text-[#1b1b1f]">
                  Activity Intensity Heatmap
                </h2>
              </div>
              <span className="text-xs text-[#77777f]">Day of week × Hour of day (UTC)</span>
            </div>

            <div className="rounded-2xl border border-[#ececf0] bg-white p-5 shadow-sm space-y-4">
              {/* Heatmap Visual Grid */}
              <div
                role="img"
                aria-label="Activity heatmap showing volume distribution across 7 days and 24 hours"
                className="overflow-x-auto"
              >
                <div className="min-w-[700px] space-y-1.5">
                  {/* Hour Headers */}
                  <div className="grid grid-cols-[48px_repeat(24,1fr)] gap-1 text-[10px] text-[#8c8c96] font-mono text-center">
                    <span />
                    {Array.from({ length: 24 }, (_, i) => (
                      <span key={i}>{i}</span>
                    ))}
                  </div>

                  {/* Matrix Rows */}
                  {heatmapMatrix.map((dayCells, dayIdx) => (
                    <div
                      key={dayIdx}
                      className="grid grid-cols-[48px_repeat(24,1fr)] gap-1 items-center"
                    >
                      <span className="text-xs font-medium text-[#77777f]">
                        {DAY_NAMES[dayIdx]}
                      </span>
                      {dayCells.map((cell) => {
                        const colorClass = getHeatmapCellColor(cell.count, maxHeatmapCount)
                        return (
                          <div
                            key={cell.hour}
                            title={`${DAY_NAMES[cell.dayOfWeek]} ${cell.hour}:00 UTC — ${cell.count} activities`}
                            className={`h-7 rounded flex items-center justify-center text-[10px] font-mono font-medium transition-colors ${colorClass}`}
                          >
                            {cell.count > 0 ? cell.count : ''}
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>

              {/* SR-Only Accessible Table */}
              <div className="sr-only">
                <table>
                  <caption>Activity counts by day and hour</caption>
                  <thead>
                    <tr>
                      <th>Day</th>
                      {Array.from({ length: 24 }, (_, i) => (
                        <th key={i}>{i}:00</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {heatmapMatrix.map((dayCells, dayIdx) => (
                      <tr key={dayIdx}>
                        <td>{DAY_NAMES[dayIdx]}</td>
                        {dayCells.map((cell) => (
                          <td key={cell.hour}>{cell.count}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* 4. Activity Trend Chart */}
          {trendChartData && (
            <section aria-label="Activity Trend" className="space-y-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-indigo-600" />
                <h2 className="text-base font-semibold text-[#1b1b1f]">Activity Trend</h2>
              </div>
              <div className="rounded-2xl border border-[#ececf0] bg-white p-5 shadow-sm">
                <ReportChart chart={trendChartData} hideControls />
              </div>
            </section>
          )}

          {/* 5. Top Performers Leaderboard (Contract E26) */}
          <section aria-label="Top Performers Leaderboard" className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Award className="h-5 w-5 text-amber-500" />
                <h2 className="text-base font-semibold text-[#1b1b1f]">
                  Top Performers Leaderboard
                </h2>
              </div>
              <span className="text-xs text-[#77777f]">Ranked by performance metrics</span>
            </div>

            <div className="rounded-2xl border border-[#ececf0] bg-white shadow-sm overflow-hidden">
              <ResponsiveTableWrapper>
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[#ececf0] bg-[#fafafb] font-semibold text-[#77777f]">
                    <tr>
                      <th className="py-3 px-4">Rank & Member</th>
                      <th className="py-3 px-3">
                        <button
                          type="button"
                          onClick={() => {
                            setSortBy('ACTIVITIES')
                            setAppliedFilters((prev) => ({ ...prev, sortBy: 'ACTIVITIES' }))
                          }}
                          className={`min-h-[44px] font-semibold hover:text-[#1b1b1f] ${
                            sortBy === 'ACTIVITIES' ? 'text-indigo-600 underline' : ''
                          }`}
                        >
                          Activities Logged
                        </button>
                      </th>
                      <th className="py-3 px-3">
                        <button
                          type="button"
                          onClick={() => {
                            setSortBy('TASKS_COMPLETED')
                            setAppliedFilters((prev) => ({ ...prev, sortBy: 'TASKS_COMPLETED' }))
                          }}
                          className={`min-h-[44px] font-semibold hover:text-[#1b1b1f] ${
                            sortBy === 'TASKS_COMPLETED' ? 'text-indigo-600 underline' : ''
                          }`}
                        >
                          Tasks Completed
                        </button>
                      </th>
                      <th className="py-3 px-3">
                        <button
                          type="button"
                          onClick={() => {
                            setSortBy('DEALS_CLOSED')
                            setAppliedFilters((prev) => ({ ...prev, sortBy: 'DEALS_CLOSED' }))
                          }}
                          className={`min-h-[44px] font-semibold hover:text-[#1b1b1f] ${
                            sortBy === 'DEALS_CLOSED' ? 'text-indigo-600 underline' : ''
                          }`}
                        >
                          Deals Closed
                        </button>
                      </th>
                      <th className="py-3 px-3">
                        <button
                          type="button"
                          onClick={() => {
                            setSortBy('TIME_TRACKED')
                            setAppliedFilters((prev) => ({ ...prev, sortBy: 'TIME_TRACKED' }))
                          }}
                          className={`min-h-[44px] font-semibold hover:text-[#1b1b1f] ${
                            sortBy === 'TIME_TRACKED' ? 'text-indigo-600 underline' : ''
                          }`}
                        >
                          Time Tracked
                        </button>
                      </th>
                      <th className="py-3 px-4 text-right">Drill-down</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#ececf0] text-[#1b1b1f]">
                    {leaderboardRows.map((row) => (
                      <tr
                        key={row.userId}
                        data-testid={`leaderboard-row-${row.userId}`}
                        className="transition-colors hover:bg-[#fafafb]"
                      >
                        <td className="py-3 px-4 font-medium flex items-center gap-2">
                          <span
                            className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                              row.rank === 1
                                ? 'bg-amber-100 text-amber-800'
                                : row.rank === 2
                                  ? 'bg-slate-200 text-slate-800'
                                  : row.rank === 3
                                    ? 'bg-amber-50 text-amber-700'
                                    : 'text-[#8c8c96]'
                            }`}
                          >
                            {row.rank}
                          </span>
                          <span>
                            {row.firstName} {row.lastName}
                          </span>
                        </td>
                        <td className="py-3 px-3 font-mono">{row.activitiesLogged}</td>
                        <td className="py-3 px-3 font-mono">{row.tasksCompleted}</td>
                        <td className="py-3 px-3 font-mono">{row.dealsClosed}</td>
                        <td className="py-3 px-3 font-mono">
                          {formatDurationSeconds(row.timeTrackedSeconds)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`View drill-down for ${row.firstName} ${row.lastName}`}
                            onClick={() => {
                              setDrillDownUserId(row.userId)
                              setDrillDownPage(1)
                            }}
                            className="min-h-[44px] gap-1 text-xs text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
                          >
                            <span>Drill down</span>
                            <ChevronRight className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ResponsiveTableWrapper>
            </div>
          </section>

          {/* 6. Team Comparison (Contract E26) */}
          {teamComparisonRows.length > 0 && (
            <section aria-label="Team Comparison" className="space-y-3">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-indigo-600" />
                <h2 className="text-base font-semibold text-[#1b1b1f]">Team Comparison</h2>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {teamComparisonRows.map((team) => (
                  <div
                    key={team.teamId}
                    data-testid={`team-card-${team.teamId}`}
                    className="rounded-2xl border border-[#ececf0] bg-white p-5 shadow-sm space-y-4"
                  >
                    <div className="border-b border-[#ececf0] pb-2">
                      <h3 className="font-semibold text-sm text-[#1b1b1f]">{team.teamName}</h3>
                    </div>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-[#77777f]">Total Activities:</span>
                        <span className="font-mono font-medium">{team.totalActivities}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#77777f]">Tasks Completed:</span>
                        <span className="font-mono font-medium">{team.tasksCompleted}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#77777f]">Completion Rate:</span>
                        <span className="font-mono font-medium text-emerald-600">
                          {formatCompletionRate(team.completionRate)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#77777f]">Avg Time:</span>
                        <span className="font-mono font-medium">
                          {formatDurationHours(team.avgCompletionTimeHours)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#77777f]">Overdue Tasks:</span>
                        <span className="font-mono font-medium text-red-600">
                          {team.overdueTasks}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#77777f]">Time Tracked:</span>
                        <span className="font-mono font-medium">
                          {formatDurationSeconds(team.timeTrackedSeconds)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 7. User Drill-down Panel (Contract E26) */}
          {drillDownUserId && (
            <section
              aria-label="User Drill-Down Panel"
              data-testid="drill-down-panel"
              className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-5 shadow-sm space-y-4"
            >
              <div className="flex items-center justify-between border-b border-indigo-200 pb-3">
                <div className="flex items-center gap-2">
                  <Award className="h-5 w-5 text-indigo-600" />
                  <h2 className="text-base font-semibold text-[#1b1b1f]">
                    Individual Performance Drill-Down
                    {drillDownQuery.data?.user &&
                      `: ${drillDownQuery.data.user.firstName} ${drillDownQuery.data.user.lastName}`}
                  </h2>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Close drill-down"
                  onClick={() => setDrillDownUserId(null)}
                  className="min-h-[44px] min-w-[44px] text-[#77777f] hover:text-[#1b1b1f]"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {drillDownQuery.isLoading ? (
                <div data-testid="drilldown-skeleton">
                  <LoadingSkeleton />
                </div>
              ) : drillDownQuery.isError ? (
                <ErrorState
                  title="Could not load drill-down data"
                  message={
                    (drillDownQuery.error as Error).message ||
                    'Failed to retrieve individual activity drill-down.'
                  }
                  onRetry={() => drillDownQuery.refetch()}
                />
              ) : drillDownQuery.data ? (
                <div className="space-y-4">
                  {/* Summary row */}
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded-xl bg-white p-3 border border-[#ececf0]">
                      <p className="text-[11px] text-[#77777f]">Activities Logged</p>
                      <p className="text-base font-bold text-[#1b1b1f]">
                        {drillDownQuery.data.summary.totalActivities}
                      </p>
                    </div>
                    <div className="rounded-xl bg-white p-3 border border-[#ececf0]">
                      <p className="text-[11px] text-[#77777f]">Tasks Completed</p>
                      <p className="text-base font-bold text-[#1b1b1f]">
                        {drillDownQuery.data.summary.tasksCompleted}
                      </p>
                    </div>
                    <div className="rounded-xl bg-white p-3 border border-[#ececf0]">
                      <p className="text-[11px] text-[#77777f]">Deals Closed</p>
                      <p className="text-base font-bold text-[#1b1b1f]">
                        {drillDownQuery.data.dealsClosed}
                      </p>
                    </div>
                    <div className="rounded-xl bg-white p-3 border border-[#ececf0]">
                      <p className="text-[11px] text-[#77777f]">Time Tracked</p>
                      <p className="text-base font-bold text-[#1b1b1f]">
                        {formatDurationSeconds(drillDownQuery.data.summary.timeTrackedSeconds)}
                      </p>
                    </div>
                  </div>

                  {/* Recent Activities Feed */}
                  <div className="rounded-xl bg-white p-4 border border-[#ececf0] space-y-3">
                    <h3 className="text-xs font-semibold text-[#1b1b1f]">Recent Activities</h3>
                    <div className="divide-y divide-[#ececf0]">
                      {drillDownQuery.data.recentActivities.items.map((act) => (
                        <div
                          key={act.id}
                          className="py-2 flex items-center justify-between text-xs"
                        >
                          <div>
                            <p className="font-medium text-[#1b1b1f]">{act.title}</p>
                            <p className="text-[11px] text-[#8c8c96]">
                              {ACTIVITY_TYPE_LABELS[act.type] || act.type}
                            </p>
                          </div>
                          <time dateTime={act.createdAt} className="text-[11px] text-[#77777f]">
                            {new Date(act.createdAt).toLocaleString()}
                          </time>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
          )}
        </div>
      )}

      {/* Activity Goal Dialog (Create & Edit) */}
      <ActivityGoalDialog
        open={goalDialogOpen}
        onOpenChange={setGoalDialogOpen}
        goal={editingGoal}
        users={usersList}
      />

      {/* Goal Delete Confirmation Dialog */}
      <Dialog open={Boolean(deletingGoalId)} onOpenChange={() => setDeletingGoalId(null)}>
        <DialogContent className="max-w-sm bg-white p-6 rounded-2xl shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-[#1b1b1f]">
              Delete Activity Goal
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-[#4b4b55] pt-1">
            Are you sure you want to delete this activity target? This action cannot be undone.
          </p>
          <DialogFooter className="pt-4 gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeletingGoalId(null)}
              className="min-h-[44px] text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => deletingGoalId && deleteGoalMutation.mutate(deletingGoalId)}
              disabled={deleteGoalMutation.isPending}
              className="min-h-[44px] bg-red-600 hover:bg-red-700 text-white text-xs"
            >
              Delete Goal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
