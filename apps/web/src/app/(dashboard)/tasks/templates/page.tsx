import { TaskTemplatesManager } from '@/components/tasks/TaskTemplatesManager'
import { QueryProvider } from '@/components/contacts/QueryProvider'

export default function TaskTemplatesPage(): React.JSX.Element {
  return (
    <QueryProvider>
      <div className="space-y-6 p-6 text-slate-950">
        <TaskTemplatesManager />
      </div>
    </QueryProvider>
  )
}
