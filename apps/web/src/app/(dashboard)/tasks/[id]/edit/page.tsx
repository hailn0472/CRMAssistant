import { redirect } from 'next/navigation'

type EditTaskPageProps = {
  params: { id: string }
}

export default function EditTaskPage({ params }: EditTaskPageProps): never {
  redirect(`/tasks/${params.id}`)
}
