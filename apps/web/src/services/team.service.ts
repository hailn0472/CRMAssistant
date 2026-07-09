type GraphqlResponse<T> = {
  data?: T
  errors?: Array<{ message: string }>
}

export async function graphqlRequest<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await fetch('/api/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  const payload = (await response.json()) as GraphqlResponse<T>

  if (!response.ok || payload.errors?.length) {
    throw new Error(payload.errors?.[0]?.message ?? 'GraphQL request failed')
  }

  if (!payload.data) {
    throw new Error('GraphQL response missing data')
  }

  return payload.data
}

export type Team = {
  id: string
  name: string
  managerId?: string | null
  manager?: {
    id: string
    firstName: string
    lastName: string
  } | null
  memberCount: number
  createdAt: string
}

export type TeamDetail = Team & {
  members: {
    id: string
    firstName: string
    lastName: string
    email: string
  }[]
}

export async function getTeams(): Promise<Team[]> {
  const data = await graphqlRequest<{ teams: Team[] }>(
    `query Teams {
      teams {
        id
        name
        managerId
        manager {
          id
          firstName
          lastName
        }
        memberCount
        createdAt
      }
    }`,
    {},
  )
  return data.teams
}

export async function getTeam(id: string): Promise<TeamDetail> {
  const data = await graphqlRequest<{ team: TeamDetail }>(
    `query Team($id: ID!) {
      team(id: $id) {
        id
        name
        managerId
        manager {
          id
          firstName
          lastName
        }
        members {
          id
          firstName
          lastName
          email
        }
        createdAt
      }
    }`,
    { id },
  )
  return data.team
}

export async function createTeam(input: { name: string; managerId?: string }): Promise<Team> {
  const data = await graphqlRequest<{ createTeam: Team }>(
    `mutation CreateTeam($name: String!, $managerId: String) {
      createTeam(name: $name, managerId: $managerId) {
        id
        name
        managerId
        manager {
          id
          firstName
          lastName
        }
        memberCount
        createdAt
      }
    }`,
    input,
  )
  return data.createTeam
}

export async function updateTeam(
  id: string,
  input: { name?: string; managerId?: string },
): Promise<Team> {
  const data = await graphqlRequest<{ updateTeam: Team }>(
    `mutation UpdateTeam($id: ID!, $name: String, $managerId: String) {
      updateTeam(id: $id, name: $name, managerId: $managerId) {
        id
        name
        managerId
        manager {
          id
          firstName
          lastName
        }
        memberCount
        createdAt
      }
    }`,
    { id, ...input },
  )
  return data.updateTeam
}

export async function deleteTeam(id: string): Promise<boolean> {
  const data = await graphqlRequest<{ deleteTeam: boolean }>(
    `mutation DeleteTeam($id: ID!) {
      deleteTeam(id: $id)
    }`,
    { id },
  )
  return data.deleteTeam
}

export async function setTeamMembers(teamId: string, memberIds: string[]): Promise<TeamDetail> {
  const data = await graphqlRequest<{ setTeamMembers: TeamDetail }>(
    `mutation SetTeamMembers($teamId: ID!, $memberIds: [ID!]!) {
      setTeamMembers(teamId: $teamId, memberIds: $memberIds) {
        id
        name
        managerId
        manager {
          id
          firstName
          lastName
        }
        members {
          id
          firstName
          lastName
          email
        }
        createdAt
      }
    }`,
    { teamId, memberIds },
  )
  return data.setTeamMembers
}
