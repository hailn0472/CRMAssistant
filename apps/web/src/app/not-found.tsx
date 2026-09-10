import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/EmptyState'

export default function NotFoundPage(): React.JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md">
        <EmptyState
          title="Page not found"
          description="The page you are looking for doesn't exist or has been moved."
          action={
            <Button asChild className="bg-slate-950 text-white hover:bg-slate-800">
              <Link href="/dashboard">Go to Command Center</Link>
            </Button>
          }
        />
      </div>
    </div>
  )
}
