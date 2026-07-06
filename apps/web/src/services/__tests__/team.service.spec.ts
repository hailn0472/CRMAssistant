import {
  getTeams,
  getTeam,
  createTeam,
  updateTeam,
  deleteTeam,
  setTeamMembers,
} from '../team.service'

const mockFetch = jest.fn()
global.fetch = mockFetch

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 400,
    headers: { get: jest.fn(() => 'application/json') },
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response
}

describe('teamService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('getTeams', () => {
    it('should return all teams', async () => {
      const teams = [{ id: 't-1', name: 'Engineering', memberCount: 3 }]
      mockFetch.mockResolvedValue(jsonResponse({ data: { teams } }))

      const result = await getTeams()

      expect(result).toEqual(teams)
    })
  })

  describe('getTeam', () => {
    it('should return team detail by id', async () => {
      const team = { id: 't-1', name: 'Engineering', members: [] }
      mockFetch.mockResolvedValue(jsonResponse({ data: { team } }))

      const result = await getTeam('t-1')

      expect(result).toEqual(team)
    })
  })

  describe('createTeam', () => {
    it('should create team and return result', async () => {
      const team = { id: 't-1', name: 'Sales', memberCount: 0 }
      mockFetch.mockResolvedValue(jsonResponse({ data: { createTeam: team } }))

      const result = await createTeam({ name: 'Sales' })

      expect(result).toEqual(team)
    })
  })

  describe('updateTeam', () => {
    it('should update team fields', async () => {
      const team = { id: 't-1', name: 'Updated', memberCount: 5 }
      mockFetch.mockResolvedValue(jsonResponse({ data: { updateTeam: team } }))

      const result = await updateTeam('t-1', { name: 'Updated' })

      expect(result).toEqual(team)
    })
  })

  describe('deleteTeam', () => {
    it('should delete team and return true', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ data: { deleteTeam: true } }))

      const result = await deleteTeam('t-1')

      expect(result).toBe(true)
    })
  })

  describe('setTeamMembers', () => {
    it('should assign members to team', async () => {
      const team = {
        id: 't-1',
        name: 'Engineering',
        members: [{ id: 'u-1', firstName: 'A', lastName: 'B', email: 'a@b.com' }],
      }
      mockFetch.mockResolvedValue(jsonResponse({ data: { setTeamMembers: team } }))

      const result = await setTeamMembers('t-1', ['u-1'])

      expect(result).toEqual(team)
    })
  })

  describe('graphql error handling', () => {
    it('should throw on GraphQL errors', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ errors: [{ message: 'Not authorized' }] }, false))

      await expect(getTeams()).rejects.toThrow('Not authorized')
    })

    it('should throw when response data is missing', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ data: null }))

      await expect(getTeams()).rejects.toThrow('GraphQL response missing data')
    })
  })
})
