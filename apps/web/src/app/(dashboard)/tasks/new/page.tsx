import { Suspense } from 'react'

import { TaskForm } from '@/components/tasks/TaskForm'
import { QueryProvider } from '@/components/contacts/QueryProvider'

export default function NewTaskPage(): React.JSX.Element {
  return (
    <QueryProvider>
      <div className="space-y-6 p-6 text-slate-950">
        <Suspense>
          <TaskForm />
        </Suspense>
      </div>
    </QueryProvider>
  )
}
