import { ActivityLogPreferencesForm } from '@/components/settings/ActivityLogPreferencesForm'

export default function ActivityLoggingSettingsPage(): React.JSX.Element {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Activity Logging</h1>
        <p className="mt-1 text-sm text-slate-600">
          Choose which automatic events from tasks, deals and messages appear on contact timelines.
        </p>
      </div>
      <ActivityLogPreferencesForm />
    </div>
  )
}
