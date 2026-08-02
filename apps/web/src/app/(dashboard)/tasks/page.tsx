import { TasksTable } from '@/components/tasks/TasksTable'
import { QueryProvider } from '@/components/contacts/QueryProvider'

export default function TasksPage(): React.JSX.Element {
  return (
    <QueryProvider>
      <div className="space-y-6 p-6 text-slate-950">
        <TasksTable />
      </div>
    </QueryProvider>
  )
}
