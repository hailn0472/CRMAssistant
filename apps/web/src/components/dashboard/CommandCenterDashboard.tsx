import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AtRiskDealsWidget } from './AtRiskDealsWidget'

interface PriorityAction {
  title: string
  reason: string
  urgency: string
  relatedRecord: string
  status: 'Due today' | 'At risk' | 'Review' | 'Overdue'
}

interface MetricItem {
  label: string
  value: string
  context: string
}

interface ActivityItem {
  event: string
  time: string
}

interface RolePlaceholder {
  role: string
  focus: string
}

const priorityActions: PriorityAction[] = [
  {
    title: 'Follow-up due with Acme Vietnam',
    reason: 'Reason: last proposal reply is waiting on pricing confirmation.',
    urgency: 'Due today before 15:00',
    relatedRecord: 'Contact: Linh Tran',
    status: 'Due today',
  },
  {
    title: 'At-risk deal needs owner review',
    reason: 'Reason: decision date moved twice and no next meeting is logged.',
    urgency: 'At risk this week',
    relatedRecord: 'Deal: Renewal sample - Northstar Retail',
    status: 'At risk',
  },
  {
    title: 'Contact import review pending',
    reason: 'Reason: 18 sample rows need duplicate checks before activation.',
    urgency: 'Review before outreach',
    relatedRecord: 'Import: Q2 leads sample file',
    status: 'Review',
  },
  {
    title: 'Overdue task for onboarding call',
    reason: 'Reason: support handoff is blocked until call notes are added.',
    urgency: 'Overdue by 1 day',
    relatedRecord: 'Task: Add onboarding summary',
    status: 'Overdue',
  },
]

const metricItems: MetricItem[] = [
  {
    label: 'Pipeline sample',
    value: '$128k demo',
    context: 'Sample value only; review at-risk deal before forecasting.',
  },
  {
    label: 'Follow-ups sample',
    value: '7 planned',
    context: 'Demo queue for today; start with overdue and due-today items.',
  },
  {
    label: 'Team activity sample',
    value: '14 logged',
    context: 'Sample activity count showing where customer work will appear.',
  },
]

const recentActivities: ActivityItem[] = [
  { event: 'Demo note added to Acme Vietnam follow-up', time: 'Sample: 20 minutes ago' },
  { event: 'Northstar Retail deal marked for manager review', time: 'Sample: 1 hour ago' },
  { event: 'Q2 leads import completed duplicate scan', time: 'Sample: yesterday' },
]

const rolePlaceholders: RolePlaceholder[] = [
  { role: 'Sales Rep', focus: 'Planned view: next calls, overdue follow-ups, and active deals.' },
  {
    role: 'Sales Manager',
    focus: 'Planned view: team blockers, risk review, and forecast checks.',
  },
  { role: 'Admin', focus: 'Planned view: imports, settings readiness, and access requests.' },
  {
    role: 'Support Agent',
    focus: 'Planned view: handoffs, open customer tasks, and response queues.',
  },
]

function getStatusVariant(status: PriorityAction['status']): 'neutral' | 'warning' | 'danger' {
  if (status === 'At risk' || status === 'Overdue') {
    return 'danger'
  }

  if (status === 'Due today') {
    return 'warning'
  }

  return 'neutral'
}

export function CommandCenterDashboard(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-2">
        <Badge variant="neutral">Sample dashboard skeleton</Badge>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Command Center</h1>
        <p className="max-w-3xl text-sm leading-6 text-slate-600">
          Start with the records that need attention today. All values below are sample or planned
          placeholders until CRM data is connected.
        </p>
      </header>

      <section aria-labelledby="priority-action-queue-heading" className="space-y-3">
        <div>
          <h2 id="priority-action-queue-heading" className="text-xl font-semibold text-slate-950">
            Priority action queue
          </h2>
          <p className="text-sm text-slate-600">3-5 sample items ordered by urgency.</p>
        </div>
        <ul className="grid gap-3 lg:grid-cols-2">
          {priorityActions.map((action) => (
            <li key={action.title}>
              <Card className="h-full border-slate-200 shadow-sm">
                <CardHeader className="space-y-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <CardTitle className="text-base leading-6 text-slate-950">
                      {action.title}
                    </CardTitle>
                    <Badge variant={getStatusVariant(action.status)}>{action.status}</Badge>
                  </div>
                  <CardDescription>{action.relatedRecord}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-slate-600">
                  <p>{action.reason}</p>
                  <p className="font-medium text-slate-800">Urgency: {action.urgency}</p>
                  <Button type="button" variant="outline" size="sm">
                    Review sample action
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="metric-strip-heading" className="space-y-3">
        <h2 id="metric-strip-heading" className="text-xl font-semibold text-slate-950">
          Metric strip
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {metricItems.map((metric) => (
            <Card key={metric.label} className="border-slate-200 shadow-sm">
              <CardHeader>
                <CardDescription>{metric.label}</CardDescription>
                <CardTitle className="text-2xl text-slate-950">{metric.value}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-6 text-slate-600">{metric.context}</p>
              </CardContent>
            </Card>
          ))}
          {/* Live at-risk deals — replaces the removed 'At-risk deals sample' card */}
          <AtRiskDealsWidget />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <section aria-labelledby="recent-activity-heading" className="space-y-3">
          <h2 id="recent-activity-heading" className="text-xl font-semibold text-slate-950">
            Recent activity preview
          </h2>
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="pt-6">
              <ol className="space-y-4">
                {recentActivities.map((activity) => (
                  <li key={activity.event} className="border-l-2 border-blue-200 pl-4">
                    <p className="font-medium text-slate-950">{activity.event}</p>
                    <p className="text-sm text-slate-600">{activity.time}</p>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </section>

        <section aria-labelledby="first-actions-heading" className="space-y-3">
          <h2 id="first-actions-heading" className="text-xl font-semibold text-slate-950">
            First actions for an empty dashboard
          </h2>
          <Card className="border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base text-slate-950">
                Set up the first work queue
              </CardTitle>
              <CardDescription>
                Use these safe actions while contacts and deals modules are still being connected.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row">
              <Button type="button" variant="outline" disabled>
                Import contacts - planned
              </Button>
              <Button type="button" variant="outline" disabled>
                Create first deal - planned
              </Button>
            </CardContent>
          </Card>
        </section>
      </div>

      <section aria-labelledby="role-specific-heading" className="space-y-3">
        <h2 id="role-specific-heading" className="text-xl font-semibold text-slate-950">
          Role-specific planned sections
        </h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {rolePlaceholders.map((placeholder) => (
            <section
              key={placeholder.role}
              aria-labelledby={`${placeholder.role.toLowerCase().replaceAll(' ', '-')}-heading`}
            >
              <Card className="h-full border-slate-200 shadow-sm">
                <CardHeader>
                  <Badge variant="neutral">Planned sample</Badge>
                  <CardTitle
                    id={`${placeholder.role.toLowerCase().replaceAll(' ', '-')}-heading`}
                    className="text-base text-slate-950"
                  >
                    {placeholder.role}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-6 text-slate-600">{placeholder.focus}</p>
                </CardContent>
              </Card>
            </section>
          ))}
        </div>
      </section>
    </div>
  )
}
