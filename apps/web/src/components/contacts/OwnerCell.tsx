'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export type OwnerData = {
  id: string
  firstName: string
  lastName: string
  email: string
  avatar?: string | null
}

type OwnerCellProps = {
  ownerId: string
  owner?: OwnerData | null
}

function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase()
}

function getAvatarColor(name: string): string {
  const colors = [
    'bg-indigo-500',
    'bg-emerald-500',
    'bg-sky-500',
    'bg-amber-500',
    'bg-rose-500',
    'bg-violet-500',
    'bg-teal-500',
    'bg-orange-500',
  ]
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash) % colors.length]
}

export function OwnerCell({ ownerId: _ownerId, owner }: OwnerCellProps): React.JSX.Element {
  const [imgFailed, setImgFailed] = useState(false)
  const isUnassigned = !owner

  if (isUnassigned) {
    return (
      <Badge variant="secondary" className="text-xs font-normal text-slate-500">
        Unassigned
      </Badge>
    )
  }

  const fullName = `${owner.firstName} ${owner.lastName}`
  const initials = getInitials(owner.firstName, owner.lastName)

  return (
    <div className="flex items-center gap-2">
      {owner.avatar && !imgFailed ? (
        <img
          src={owner.avatar}
          alt={fullName}
          className="h-8 w-8 rounded-full object-cover"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <span
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium text-white',
            getAvatarColor(fullName),
          )}
        >
          {initials}
        </span>
      )}
      <span className="max-w-[120px] truncate text-sm text-slate-700">{fullName}</span>
    </div>
  )
}
