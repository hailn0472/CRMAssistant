import Link from 'next/link'

export default function TaskNotFound(): React.JSX.Element {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-10 text-center shadow-sm">
      <h2 className="text-xl font-semibold tracking-tight text-slate-950">Task not found</h2>
      <p className="mt-2 max-w-md text-sm text-slate-600">
        The task you are looking for does not exist, has been deleted, or you do not have access to
        it.
      </p>
      <Link
        href="/tasks"
        className="mt-5 inline-flex h-11 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-medium text-white hover:bg-slate-800"
      >
        Back to tasks
      </Link>
    </div>
  )
}
