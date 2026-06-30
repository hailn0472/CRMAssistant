import { WorkspaceHeader } from '@/components/layout/AppShell'

export default function SettingsPage(): React.JSX.Element {
  return (
    <WorkspaceHeader
      eyebrow="Settings"
      title="Preferences"
      description="System configuration and personal preferences will be available here."
    />
  )
}
