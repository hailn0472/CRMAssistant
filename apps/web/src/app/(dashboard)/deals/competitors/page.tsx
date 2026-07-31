import { CompetitorsManager } from '@/components/competitors/CompetitorsManager'
import { QueryProvider } from '@/components/contacts/QueryProvider'

export default function CompetitorsPage(): React.JSX.Element {
  return (
    <QueryProvider>
      <CompetitorsManager />
    </QueryProvider>
  )
}
