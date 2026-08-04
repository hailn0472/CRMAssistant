import { TaskFormPanel } from '@/components/tasks/TaskFormPanel'
import { QueryProvider } from '@/components/contacts/QueryProvider'

export default function NewTaskPage(): React.JSX.Element {
  return (
    <QueryProvider>
      <TaskFormPanel />
    </QueryProvider>
  )
}
