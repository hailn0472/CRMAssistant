import { ForecastReport } from '@/components/reports/ForecastReport'
import { QueryProvider } from '@/components/contacts/QueryProvider'

export default function ForecastPage(): React.JSX.Element {
  return (
    <QueryProvider>
      <ForecastReport />
    </QueryProvider>
  )
}
