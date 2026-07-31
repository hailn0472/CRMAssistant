import { WinLossReport } from '@/components/reports/WinLossReport'
import { QueryProvider } from '@/components/contacts/QueryProvider'

export default function WinLossPage(): React.JSX.Element {
  return (
    <QueryProvider>
      <WinLossReport />
    </QueryProvider>
  )
}
