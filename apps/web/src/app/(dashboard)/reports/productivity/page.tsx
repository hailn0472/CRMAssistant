import { ProductivityReport } from '@/components/reports/ProductivityReport'
import { QueryProvider } from '@/components/contacts/QueryProvider'

export default function ProductivityPage(): React.JSX.Element {
  return (
    <QueryProvider>
      <ProductivityReport />
    </QueryProvider>
  )
}
