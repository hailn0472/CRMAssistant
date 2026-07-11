export type GraphqlResponse<T> = {
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

  if (!response.ok) {
    throw new Error(`GraphQL request failed with status ${response.status}`)
  }

  const payload = (await response.json()) as GraphqlResponse<T>

  if (payload.errors?.length) {
    throw new Error(payload.errors[0]?.message ?? 'GraphQL request failed')
  }

  if (!payload.data) {
    throw new Error('GraphQL response missing data')
  }

  return payload.data
}
