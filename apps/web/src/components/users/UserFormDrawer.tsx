'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'

import { UserForm } from '@/components/users/UserForm'
import type { User } from '@/services/user.service'

type UserFormDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: (user: User) => void
}

export function UserFormDrawer({
  open,
  onOpenChange,
  onSaved,
}: UserFormDrawerProps): React.JSX.Element | null {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onOpenChange])

  if (!open || !mounted) return null

  function handleSaved(user: User): void {
    void queryClient.invalidateQueries({ queryKey: ['users'] })
    void queryClient.invalidateQueries({ queryKey: ['users-stats'] })
    onOpenChange(false)
    if (onSaved) {
      onSaved(user)
      return
    }
    router.push(`/users/${user.id}`)
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={() => onOpenChange(false)}
        className="absolute inset-0 bg-slate-900/30 backdrop-blur-[2px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="New user"
        className="relative flex h-full w-[540px] max-w-full flex-col border-l border-[#e6e6eb] bg-white shadow-[-24px_0_60px_rgba(20,20,26,0.12)]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#f0f0f4] px-6 pb-[18px] pt-[22px]">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[#1b1b1f]">
              New user
            </h2>
            <p className="text-[12.5px] text-[#8c8c96]">Add a teammate to this workspace.</p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close panel"
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] border border-[#e6e6eb] bg-white text-[15px] leading-none text-[#6b6b76] transition-colors hover:bg-[#f4f4f6]"
          >
            ×
          </button>
        </div>

        <UserForm onSaved={handleSaved} onCancel={() => onOpenChange(false)} />
      </div>
    </div>,
    document.body,
  )
}
