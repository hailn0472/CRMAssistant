import { TasksWorkspace } from '@/components/tasks/TasksWorkspace'
import { QueryProvider } from '@/components/contacts/QueryProvider'

export default function TasksPage(): React.JSX.Element {
  return (
    <QueryProvider>
      <TasksWorkspace />
    </QueryProvider>
  )
}
