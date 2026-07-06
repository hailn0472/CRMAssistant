'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { getTeam, setTeamMembers } from '@/services/team.service'
import { getUsers } from '@/services/user.service'

type TeamMemberManagerProps = {
  teamId: string
}

export function TeamMemberManager({ teamId }: TeamMemberManagerProps): React.JSX.Element {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [selectedAvailable, setSelectedAvailable] = useState<Set<string>>(new Set())

  const { data: team, isLoading: teamLoading } = useQuery({
    queryKey: ['team', teamId],
    queryFn: () => getTeam(teamId),
  })

  const { data: allUsers, isLoading: usersLoading } = useQuery({
    queryKey: ['users', { pageSize: 200 }],
    queryFn: async () => {
      const res = await getUsers(1, 200)
      return res.items
    },
  })

  const memberIds = new Set(team?.members.map((m) => m.id) ?? [])

  const availableUsers = (allUsers ?? []).filter((u) => !memberIds.has(u.id))

  const filteredAvailable = availableUsers.filter((u) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      u.email.toLowerCase().includes(q) ||
      u.firstName.toLowerCase().includes(q) ||
      u.lastName.toLowerCase().includes(q)
    )
  })

  const saveMutation = useMutation({
    mutationFn: (newMemberIds: string[]) => setTeamMembers(teamId, newMemberIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team', teamId] })
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      setSelectedAvailable(new Set())
    },
  })

  function handleAdd(): void {
    const newMemberIds = [...memberIds, ...selectedAvailable]
    saveMutation.mutateAsync(newMemberIds).catch(() => {
      // error handled by TanStack Query onError / UI state
    })
  }

  function handleRemove(memberId: string): void {
    const newMemberIds = [...memberIds].filter((id) => id !== memberId)
    saveMutation.mutateAsync(newMemberIds).catch(() => {
      // error handled by TanStack Query onError / UI state
    })
  }

  function toggleSelect(id: string): void {
    setSelectedAvailable((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const isLoading = teamLoading || usersLoading

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-2 py-8 text-sm text-slate-400">Loading members...</div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      <Card className="border-slate-200 bg-white p-4">
        <h3 className="mb-3 font-medium text-slate-950">Available Users</h3>
        <Input
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-3"
        />
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {filteredAvailable.length === 0 ? (
            <p className="text-sm text-slate-400">All users are in this team</p>
          ) : (
            filteredAvailable.map((user) => (
              <label
                key={user.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={selectedAvailable.has(user.id)}
                  onChange={() => toggleSelect(user.id)}
                />
                <span className="text-sm">
                  {user.firstName} {user.lastName}{' '}
                  <span className="text-slate-400">({user.email})</span>
                </span>
              </label>
            ))
          )}
        </div>
        {selectedAvailable.size > 0 && (
          <Button
            size="sm"
            className="mt-3 bg-slate-950 text-white hover:bg-slate-800"
            onClick={handleAdd}
            disabled={saveMutation.isPending}
          >
            Add selected ({selectedAvailable.size})
          </Button>
        )}
      </Card>

      <Card className="border-slate-200 bg-white p-4">
        <h3 className="mb-3 font-medium text-slate-950">Team Members ({memberIds.size})</h3>
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {!team || team.members.length === 0 ? (
            <p className="text-sm text-slate-400">No members yet</p>
          ) : (
            team.members.map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-slate-50"
              >
                <span className="text-sm">
                  {member.firstName} {member.lastName}{' '}
                  <span className="text-slate-400">({member.email})</span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-600 hover:bg-red-50"
                  onClick={() => handleRemove(member.id)}
                  disabled={saveMutation.isPending}
                >
                  Remove
                </Button>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  )
}
