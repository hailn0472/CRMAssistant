'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Plus } from 'lucide-react'

import { UsersTable } from '@/components/users/UsersTable'
import { UserMetricsCards } from '@/components/users/UserMetricsCards'
import { UserFormDrawer } from '@/components/users/UserFormDrawer'

export function UsersWorkspace(): React.JSX.Element {
  const [createOpen, setCreateOpen] = useState(false)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-[27px] font-semibold tracking-[-0.025em] text-[#1b1b1f]">Users</h1>
          <p className="text-[13.5px] text-[#77777f]">
            Manage workspace access, roles and invitations.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/settings/roles"
            className="inline-flex h-9 items-center rounded-[9px] border border-[#e6e6eb] bg-white px-3.5 text-[13px] font-medium text-[#4b4b55] transition-colors hover:bg-[#f4f4f6]"
          >
            Manage roles
          </Link>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#1b1b1f] bg-[#1b1b1f] px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-black"
          >
            <Plus className="h-3.5 w-3.5" />
            Create user
          </button>
        </div>
      </div>

      <UserMetricsCards />

      <UsersTable />

      <UserFormDrawer open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
