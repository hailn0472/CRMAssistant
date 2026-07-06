'use client'

import Link from 'next/link'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { WorkspaceHeader } from '@/components/layout/AppShell'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { TableSkeleton } from '@/components/shared/LoadingSkeleton'
import { ResponsiveTableWrapper } from '@/components/shared/ResponsiveTableWrapper'
import { QueryProvider } from '@/components/contacts/QueryProvider'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getTeams, deleteTeam } from '@/services/team.service'
import { TeamFormDialog } from '@/components/teams/TeamFormDialog'

export default function TeamsPage(): React.JSX.Element {
  return (
    <QueryProvider>
      <TeamsPageContent />
    </QueryProvider>
  )
}

function TeamsPageContent(): React.JSX.Element {
  return (
    <main className="space-y-6 p-6 text-slate-950">
      <WorkspaceHeader
        eyebrow="Settings"
        title="Teams"
        description="Manage teams for data visibility and organization."
        actions={<CreateTeamButton />}
      />
      <TeamsTable />
    </main>
  )
}

function CreateTeamButton(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button className="bg-slate-950 text-white hover:bg-slate-800" onClick={() => setOpen(true)}>
        Create team
      </Button>
      <TeamFormDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

function TeamsTable(): React.JSX.Element {
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ['teams'],
    queryFn: getTeams,
  })
  const queryClient = useQueryClient()
  const [editingTeam, setEditingTeam] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)

  const deleteMutation = useMutation({
    mutationFn: deleteTeam,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] })
    },
  })

  if (isLoading) {
    return <TableSkeleton rows={4} columns={5} />
  }

  if (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unable to load teams.'
    return <ErrorState message={errorMessage} onRetry={() => refetch()} />
  }

  if (!data || data.length === 0) {
    return (
      <EmptyState
        title="No teams yet"
        description="Create teams to control data visibility for your sales team."
        action={
          <Button asChild className="bg-slate-950 text-white hover:bg-slate-800">
            <Link href="/settings/teams">Create team</Link>
          </Button>
        }
      />
    )
  }

  async function handleDelete(
    teamId: string,
    teamName: string,
    memberCount: number,
  ): Promise<void> {
    if (memberCount > 0) {
      alert(
        `Team "${teamName}" has ${memberCount} active member(s). Remove all members before deleting.`,
      )
      return
    }
    if (!confirm(`Delete team "${teamName}"? This cannot be undone.`)) return
    try {
      await deleteMutation.mutateAsync(teamId)
    } catch (_e: unknown) {
      const msg = _e instanceof Error ? _e.message : 'Delete failed'
      alert(msg)
    }
  }

  return (
    <>
      <Card className="border-slate-200 bg-white text-slate-950 shadow-sm">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-lg">All Teams</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveTableWrapper>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="py-3 pr-4 pl-4 font-medium">Name</th>
                  <th className="py-3 pr-4 font-medium">Manager</th>
                  <th className="py-3 pr-4 font-medium">Members</th>
                  <th className="py-3 pr-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.map((team) => (
                  <tr className="group hover:bg-slate-50" key={team.id}>
                    <td className="py-3 pr-4 pl-4 font-medium">
                      <Link
                        className="text-blue-700 hover:text-blue-800 hover:underline"
                        href={`/settings/teams/${team.id}`}
                      >
                        {team.name}
                      </Link>
                    </td>
                    <td className="py-3 pr-4 text-slate-600">
                      {team.manager ? `${team.manager.firstName} ${team.manager.lastName}` : '—'}
                    </td>
                    <td className="py-3 pr-4 text-slate-600">{team.memberCount}</td>
                    <td className="py-3 pr-4">
                      <div className="flex gap-1">
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/settings/teams/${team.id}`}>View</Link>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditingTeam(team.id)
                            setEditOpen(true)
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDelete(team.id, team.name, team.memberCount)}
                          className="text-red-600 hover:bg-red-50"
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTableWrapper>
        </CardContent>
      </Card>
      <TeamFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        teamId={editingTeam}
        onClose={() => setEditingTeam(null)}
      />
    </>
  )
}
