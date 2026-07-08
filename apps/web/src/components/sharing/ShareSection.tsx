'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { ShareDialog } from '@/components/sharing/ShareDialog'

type ShareSectionProps = {
  resourceType: 'CONTACT' | 'DEAL' | 'TASK'
  resourceId: string
}

export function ShareSection({ resourceType, resourceId }: ShareSectionProps): React.ReactElement {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} type="button">
        Share
      </Button>
      <ShareDialog
        open={open}
        onOpenChange={setOpen}
        resourceType={resourceType}
        resourceId={resourceId}
      />
    </>
  )
}
