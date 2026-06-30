'use client'

import type { User } from '@/services/user.service'

type UserProfileProps = {
  user: User
}

export function UserProfile({ user }: UserProfileProps): React.JSX.Element {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 text-slate-950 shadow-sm">
      <div className="flex items-center gap-4">
        {user.avatar ? (
          <img
            src={user.avatar}
            alt={`${user.firstName} ${user.lastName}`}
            className="h-16 w-16 rounded-full border border-slate-200 object-cover"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-lg font-semibold text-slate-500">
            {user.firstName.charAt(0)}
            {user.lastName.charAt(0)}
          </div>
        )}
        <div>
          <p className="text-lg font-semibold">
            {user.firstName} {user.lastName}
          </p>
          <p className="text-sm text-slate-600">{user.email}</p>
          <p className="text-sm text-slate-500">{user.jobTitle ?? user.role}</p>
        </div>
      </div>
    </div>
  )
}
