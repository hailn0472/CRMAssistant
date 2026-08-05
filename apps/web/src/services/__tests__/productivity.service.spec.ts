import { getProductivityReport } from '../productivity.service'

const mockFetch = jest.fn()
global.fetch = mockFetch as jest.Mock

function mockGraphqlResponse(data: unknown): void {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ data }),
  })
}

const mockReport = {
  userId: 'user-1',
  startDate: '2026-08-01',
  endDate: '2026-08-31',
  bucket: 'DAY',
  totalSeconds: 5400,
  entryCount: 2,
  trackedDays: 1,
  averageSecondsPerTrackedDay: 5400,
  byTask: [{ taskId: 'task-1', taskTitle: 'Follow up', totalSeconds: 5400, percentage: 100 }],
  byRelated: [
    {
      kind: 'CONTACT',
      id: 'contact-1',
      label: 'Grace Hopper',
      totalSeconds: 5400,
      percentage: 100,
    },
  ],
  buckets: [{ bucketStart: '2026-08-06T00:00:00.000Z', totalSeconds: 5400 }],
}

describe('productivity.service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('sends the report query with the filter variables (dates, bucket, userId)', async () => {
    mockGraphqlResponse({ productivityReport: mockReport })

    const result = await getProductivityReport({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      bucket: 'WEEK',
      userId: 'user-2',
    })

    expect(result.totalSeconds).toBe(5400)
    const [url, init] = mockFetch.mock.calls[0]!
    expect(url).toBe('/api/graphql')
    const body = JSON.parse(init!.body as string)
    expect(body.query).toContain('query ProductivityReport($input: ProductivityReportInput!)')
    expect(body.variables.input).toEqual({
      userId: 'user-2',
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      bucket: 'WEEK',
    })
    expect(body.query).toContain('byTask {')
    expect(body.query).toContain('byRelated {')
    expect(body.query).toContain('buckets {')
  })

  it('defaults bucket and userId to null when omitted', async () => {
    mockGraphqlResponse({ productivityReport: mockReport })

    await getProductivityReport({ startDate: '2026-08-01', endDate: '2026-08-31' })

    const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string)
    expect(body.variables.input).toEqual({
      userId: null,
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      bucket: null,
    })
  })
})
