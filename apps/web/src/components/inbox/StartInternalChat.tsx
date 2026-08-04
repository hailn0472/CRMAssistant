'use client'

import { useState, useCallback, useEffect } from 'react'
import { Search, MessageCircle, X, Users, Loader2, UserCheck } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'
import { getInternalAgents, createInternalConversation } from '@/services/inbox.service'
import type { AgentInfo } from '@/services/inbox.service'

type StartInternalChatProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConversationCreated: (conversationId: string) => void
}

function initials(firstName?: string, lastName?: string): string {
  const first = firstName?.charAt(0) ?? ''
  const last = lastName?.charAt(0) ?? ''
  return (first + last).toUpperCase() || '?'
}

function getRoleBadgeColor(roleName: string): string {
  switch (roleName) {
    case 'SALES_MANAGER':
      return 'bg-purple-100 text-purple-700 border-purple-200'
    case 'SALES_REP':
      return 'bg-blue-100 text-blue-700 border-blue-200'
    case 'SUPPORT_AGENT':
      return 'bg-green-100 text-green-700 border-green-200'
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200'
  }
}

function getRoleLabel(roleName: string): string {
  switch (roleName) {
    case 'SALES_MANAGER':
      return 'Sales Manager'
    case 'SALES_REP':
      return 'Sales Rep'
    case 'SUPPORT_AGENT':
      return 'Support Agent'
    default:
      return roleName
  }
}

export function StartInternalChat({
  open,
  onOpenChange,
  onConversationCreated,
}: StartInternalChatProps): React.JSX.Element | null {
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const currentUser = useAuthStore((state) => state.user)

  const fetchAgents = useCallback(async () => {
    if (!currentUser) return
    setLoading(true)
    setError(null)
    try {
      const result = await getInternalAgents(currentUser.tenantId)
      // Filter out current user
      setAgents(result.filter((a) => a.id !== currentUser.userId))
    } catch {
      setError('Failed to load agents')
    } finally {
      setLoading(false)
    }
  }, [currentUser])

  useEffect(() => {
    if (open) {
      fetchAgents()
      setSearchQuery('')
      setSelectedAgentId(null)
      setError(null)
    }
  }, [open, fetchAgents])

  const filteredAgents = agents.filter((agent) => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return (
      agent.firstName.toLowerCase().includes(q) ||
      agent.lastName.toLowerCase().includes(q) ||
      agent.email.toLowerCase().includes(q) ||
      agent.jobTitle?.toLowerCase().includes(q)
    )
  })

  async function handleCreate(): Promise<void> {
    if (!selectedAgentId || creating) return
    setCreating(true)
    try {
      const conv = await createInternalConversation([selectedAgentId])
      onConversationCreated(conv.id)
      onOpenChange(false)
    } catch {
      setError('Failed to create conversation')
    } finally {
      setCreating(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />

      {/* Dialog */}
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f4f4f6] text-[#1b1b1f]">
              <MessageCircle className="h-4 w-4" />
            </div>
            <h2 className="text-[15px] font-bold text-slate-900 tracking-tight">
              New Internal Chat
            </h2>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 pt-4 pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search agents by name, email, or role..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
              className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-[14px] outline-none transition-all focus:border-[#1b1b1f] focus:bg-white"
            />
          </div>
        </div>

        {/* Agent list */}
        <div className="max-h-[320px] overflow-y-auto px-2 py-2">
          {loading ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              <p className="text-sm text-slate-500">Loading agents...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <p className="text-sm font-medium text-red-600">{error}</p>
              <button
                type="button"
                onClick={fetchAgents}
                className="rounded-full bg-slate-900 px-5 py-2 text-xs font-medium text-white hover:bg-slate-800 transition-colors"
              >
                Try Again
              </button>
            </div>
          ) : filteredAgents.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <div className="rounded-full bg-slate-50 p-3 text-slate-300">
                <Users className="h-6 w-6" />
              </div>
              <p className="text-sm font-medium text-slate-700">
                {searchQuery ? 'No agents match your search' : 'No agents available'}
              </p>
              <p className="text-xs text-slate-500">
                {searchQuery
                  ? 'Try a different search term'
                  : 'Other team members will appear here'}
              </p>
            </div>
          ) : (
            <ul role="list" className="divide-y divide-slate-50">
              {filteredAgents.map((agent) => {
                const isSelected = selectedAgentId === agent.id
                const init = initials(agent.firstName, agent.lastName)
                return (
                  <li key={agent.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedAgentId(isSelected ? null : agent.id)}
                      className={cn(
                        'flex w-full items-center gap-3.5 rounded-xl px-3 py-3 text-left transition-all',
                        isSelected ? 'bg-[#fafafb] ring-1 ring-[#1b1b1f]/20' : 'hover:bg-slate-50',
                      )}
                    >
                      <div className="relative shrink-0">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f0f0f3] text-sm font-bold text-[#4b4b55]">
                          {init}
                        </div>
                        {agent.isOnline && (
                          <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[14px] font-semibold text-slate-900">
                            {agent.firstName} {agent.lastName}
                          </span>
                          <span
                            className={cn(
                              'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                              getRoleBadgeColor(agent.roleName),
                            )}
                          >
                            {getRoleLabel(agent.roleName)}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-[13px] text-slate-500">{agent.email}</p>
                      </div>
                      {isSelected && (
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1b1b1f] text-white">
                          <UserCheck className="h-3.5 w-3.5" />
                        </div>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-5 py-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-full px-5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!selectedAgentId || creating}
            className={cn(
              'rounded-full px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors',
              selectedAgentId && !creating
                ? 'bg-[#1b1b1f] hover:bg-black'
                : 'bg-slate-300 cursor-not-allowed',
            )}
          >
            {creating ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating...
              </span>
            ) : (
              'Start Chat'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
