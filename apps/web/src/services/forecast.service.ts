export type ForecastGroupBy = 'MONTH' | 'QUARTER' | 'OWNER' | 'TEAM'

export type ForecastBucket = {
  key: string
  label: string
  periodStart: string | null
  periodEnd: string | null
  weightedValue: number
  totalValue: number
  count: number
}

export type ForecastBand = {
  weightedValue: number
  totalValue: number
  count: number
}

export type SalesForecast = {
  buckets: ForecastBucket[]
  commit: ForecastBand
  bestCase: ForecastBand
  pipeline: ForecastBand
  currency: string
}

export type SalesForecastFilter = {
  startDate: string
  endDate: string
  groupBy: ForecastGroupBy
  ownerId?: string
  teamId?: string
}

export type ForecastAccuracyPeriod = {
  periodStart: string
  periodEnd: string
  forecastValue: number | null
  actualValue: number
  variance: number | null
  accuracyPct: number | null
}

import { graphqlRequest } from '@/lib/graphql-client'

const FORECAST_BUCKET_FIELDS = `
  key
  label
  periodStart
  periodEnd
  weightedValue
  totalValue
  count
`

const FORECAST_BAND_FIELDS = `
  weightedValue
  totalValue
  count
`

export async function getSalesForecast(filter: SalesForecastFilter): Promise<SalesForecast> {
  const data = await graphqlRequest<{ salesForecast: SalesForecast }>(
    `query SalesForecast($input: SalesForecastInput!) {
      salesForecast(input: $input) {
        buckets { ${FORECAST_BUCKET_FIELDS} }
        commit { ${FORECAST_BAND_FIELDS} }
        bestCase { ${FORECAST_BAND_FIELDS} }
        pipeline { ${FORECAST_BAND_FIELDS} }
        currency
      }
    }`,
    { input: filter },
  )
  return data.salesForecast
}

export async function getForecastAccuracy(
  startDate: string,
  endDate: string,
): Promise<ForecastAccuracyPeriod[]> {
  const data = await graphqlRequest<{ forecastAccuracy: ForecastAccuracyPeriod[] }>(
    `query ForecastAccuracy($startDate: String!, $endDate: String!) {
      forecastAccuracy(startDate: $startDate, endDate: $endDate) {
        periodStart
        periodEnd
        forecastValue
        actualValue
        variance
        accuracyPct
      }
    }`,
    { startDate, endDate },
  )
  return data.forecastAccuracy
}
