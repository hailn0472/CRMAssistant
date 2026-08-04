import { ReminderPreferencesForm } from '@/components/settings/ReminderPreferencesForm'

export default function RemindersSettingsPage(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-col gap-1">
        <h1 className="text-[24px] font-semibold tracking-[-0.025em] text-[#1b1b1f]">
          Reminder preferences
        </h1>
        <p className="max-w-[60ch] text-[13.5px] text-[#77777f]">
          Choose how and when you receive deal health reminders.
        </p>
      </div>
      <ReminderPreferencesForm />
    </div>
  )
}
