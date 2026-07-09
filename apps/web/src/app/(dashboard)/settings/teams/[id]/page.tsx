'use client'

import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'

import { WorkspaceHeader } from '@/components/layout/AppShell'
import { ErrorState } from '@/components/shared/ErrorState'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { QueryProvider } from '@/components/contacts/QueryProvider'
import { getTeam } from '@/services/team.service'
import { TeamMemberManager } from '@/components/teams/TeamMemberManager'

export default function TeamDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>()

  return (
    <main className="space-y-6 p-6 text-slate-950">
      <QueryProvider>
        <TeamDetailContent teamId={id} />
      </QueryProvider>
    </main>
  )
}

function TeamDetailContent({ teamId }: { teamId: string }): React.JSX.Element {
  const {
    data: team,
    error,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['team', teamId],
    queryFn: () => getTeam(teamId),
  })

  if (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unable to load team.'
    return <ErrorState message={errorMessage} onRetry={() => refetch()} />
  }

  const teamName = team?.name ?? (isLoading ? 'Loading...' : 'Team')

  return (
    <>
      <WorkspaceHeader
        eyebrow="Teams"
        title={teamName}
        description={
          team
            ? `Manager: ${team.manager ? `${team.manager.firstName} ${team.manager.lastName}` : 'None'}`
            : ''
        }
      />
      <Card className="border-slate-200 bg-white text-slate-950 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Members</CardTitle>
        </CardHeader>
        <CardContent>
          <TeamMemberManager teamId={teamId} />
        </CardContent>
      </Card>
    </>
  )
}
