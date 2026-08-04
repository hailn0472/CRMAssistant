import { ActivityLogPreferencesForm } from '@/components/settings/ActivityLogPreferencesForm'

export default function ActivityLoggingSettingsPage(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-col gap-1">
        <h1 className="text-[24px] font-semibold tracking-[-0.025em] text-[#1b1b1f]">
          Activity logging
        </h1>
        <p className="max-w-[60ch] text-[13.5px] text-[#77777f]">
          Choose which automatic events from tasks, deals and messages appear on contact timelines.
        </p>
      </div>
      <ActivityLogPreferencesForm />
    </div>
  )
}
