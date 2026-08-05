import { graphqlRequest } from '@/lib/graphql-client'

// ─── Types ───────────────────────────────────────────────────────────────────

export type ProductivityBucket = 'DAY' | 'WEEK' | 'MONTH'

export type ProductivityTaskBucket = {
  taskId: string
  taskTitle: string
  totalSeconds: number
  percentage: number
}

export type ProductivityRelatedBucket = {
  kind: 'CONTACT' | 'DEAL' | 'NONE'
  id: string | null
  label: string
  totalSeconds: number
  percentage: number
}

export type ProductivityTimeBucket = {
  bucketStart: string
  totalSeconds: number
}

export type ProductivityReport = {
  userId: string
  startDate: string
  endDate: string
  bucket: ProductivityBucket
  totalSeconds: number
  entryCount: number
  trackedDays: number
  averageSecondsPerTrackedDay: number
  byTask: ProductivityTaskBucket[]
  byRelated: ProductivityRelatedBucket[]
  buckets: ProductivityTimeBucket[]
}

export type ProductivityReportFilter = {
  userId?: string
  startDate: string
  endDate: string
  bucket?: ProductivityBucket
}

// ─── GraphQL documents ────────────────────────────────────────────────────────

// No codegen, no Apollo Client — a forgotten fragment field is silently
// undefined at runtime. Keep in sync with the ProductivityReport refs in
// apps/api/src/reports/reports.graphql.ts.
const PRODUCTIVITY_TIME_BUCKET_FIELDS = `
  bucketStart
  totalSeconds
`

export async function getProductivityReport(
  filter: ProductivityReportFilter,
): Promise<ProductivityReport> {
  const data = await graphqlRequest<{ productivityReport: ProductivityReport }>(
    `query ProductivityReport($input: ProductivityReportInput!) {
      productivityReport(input: $input) {
        userId
        startDate
        endDate
        bucket
        totalSeconds
        entryCount
        trackedDays
        averageSecondsPerTrackedDay
        byTask {
          taskId
          taskTitle
          totalSeconds
          percentage
        }
        byRelated {
          kind
          id
          label
          totalSeconds
          percentage
        }
        buckets { ${PRODUCTIVITY_TIME_BUCKET_FIELDS} }
      }
    }`,
    {
      input: {
        userId: filter.userId ?? null,
        startDate: filter.startDate,
        endDate: filter.endDate,
        bucket: filter.bucket ?? null,
      },
    },
  )
  return data.productivityReport
}
