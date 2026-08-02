import { ReminderPreferencesForm } from '@/components/settings/ReminderPreferencesForm'

export default function RemindersSettingsPage(): React.JSX.Element {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
          Reminder Preferences
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Choose how and when you receive deal health reminders.
        </p>
      </div>
      <ReminderPreferencesForm />
    </div>
  )
}
