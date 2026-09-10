'use client'

import Link from 'next/link'

import { UserForm } from '@/components/users/UserForm'

/// Route-level presentation of UserForm for /users/new.
/// Editing an existing user happens inline on the profile page instead.
export function UserFormPanel(): React.JSX.Element {
  return (
    <div className="mx-auto w-full max-w-[720px] space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-[27px] font-semibold tracking-[-0.025em] text-[#1b1b1f]">New user</h1>
        <p className="text-[13.5px] text-[#77777f]">Add a teammate to this workspace.</p>
      </div>

      <div className="flex flex-col overflow-hidden rounded-[14px] border border-[#ececf0] bg-white">
        <UserForm />
      </div>

      <Link
        href="/users"
        className="inline-flex text-[13px] text-[#77777f] transition-colors hover:text-[#1b1b1f]"
      >
        ← Back to users
      </Link>
    </div>
  )
}
