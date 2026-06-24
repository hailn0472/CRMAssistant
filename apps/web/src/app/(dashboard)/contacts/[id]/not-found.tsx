import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/EmptyState'

export default function ContactNotFoundPage(): React.JSX.Element {
  return (
    <div className="flex items-start justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <EmptyState
          title="Contact not found"
          description="This contact may have been deleted or you may not have access."
          action={
            <Button asChild className="bg-slate-950 text-white hover:bg-slate-800">
              <Link href="/contacts">Back to contacts</Link>
            </Button>
          }
        />
      </div>
    </div>
  )
}
