import { CustomReportBuilder } from '@/components/reports/CustomReportBuilder'

// Story 6.3 (AC 3, Contract D.23): thin App Router page — the
// (dashboard)/layout.tsx QueryProvider is already in place; do NOT wrap this
// page in another QueryProvider. Create mode is the default; edit mode is
// reached via /reports/builder?reportId=<id>.
export default function CustomReportBuilderPage(): React.JSX.Element {
  return <CustomReportBuilder />
}
