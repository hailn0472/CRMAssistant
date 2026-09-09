import type { ApolloServerPlugin, BaseContext, GraphQLRequestListener } from '@apollo/server'
import type { OperationDefinitionNode } from 'graphql'

import type {
  GraphqlMetricLabels,
  GraphqlMetricsPort,
  GraphqlOperationGroup,
  HttpStatusClassLabel,
} from './metrics.types'

type GraphqlErrorLike = { extensions?: Readonly<Record<string, unknown>> }

const CLIENT_ERROR_CODES = new Set([
  'BAD_REQUEST',
  'BAD_USER_INPUT',
  'GRAPHQL_PARSE_FAILED',
  'GRAPHQL_VALIDATION_FAILED',
  'PERSISTED_QUERY_NOT_FOUND',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'METHOD_NOT_ALLOWED',
])

/** Keep GraphQL operation labels independent of names, queries and variables. */
export function normalizeGraphqlOperation(
  operation: OperationDefinitionNode | undefined,
): GraphqlOperationGroup {
  switch (operation?.operation) {
    case 'query':
      return 'read'
    case 'mutation':
      return 'write'
    case 'subscription':
      return 'subscription'
    default:
      return 'other'
  }
}

function getGraphqlErrorCode(error: GraphqlErrorLike): string | undefined {
  const code = error.extensions?.code
  return typeof code === 'string' ? code : undefined
}

/** Treat validation/auth/input errors as client failures and unknown errors as server failures. */
export function normalizeGraphqlStatusClass(
  errors: readonly GraphqlErrorLike[] | undefined,
): HttpStatusClassLabel {
  if (!errors || errors.length === 0) return '2xx'

  const allClientErrors = errors.every((error) => {
    const code = getGraphqlErrorCode(error)
    return code !== undefined && CLIENT_ERROR_CODES.has(code)
  })

  return allClientErrors ? '4xx' : '5xx'
}

export function createGraphqlMetricsPlugin(metrics: GraphqlMetricsPort): ApolloServerPlugin {
  return {
    async requestDidStart(): Promise<GraphQLRequestListener<BaseContext>> {
      const startedAt = process.hrtime.bigint()
      let operationGroup: GraphqlOperationGroup = 'other'

      const record = (errors: readonly GraphqlErrorLike[] | undefined): void => {
        const labels: GraphqlMetricLabels = {
          operationGroup,
          statusClass: normalizeGraphqlStatusClass(errors),
        }
        const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000
        try {
          metrics.recordOperation(labels)
        } catch {
          // Telemetry must never replace a GraphQL response with an instrumentation error.
        }
        try {
          metrics.observeOperationDuration(labels, durationSeconds)
        } catch {
          // Keep counter and histogram failures isolated from one another.
        }
      }

      return {
        async didResolveOperation(requestContext): Promise<void> {
          operationGroup = normalizeGraphqlOperation(requestContext.operation)
        },
        async willSendResponse(requestContext): Promise<void> {
          // `response.errors` covers execution errors as well as parse and
          // validation errors that bypass didResolveOperation.
          const body = requestContext.response.body
          const errors = body.kind === 'single' ? body.singleResult.errors : requestContext.errors
          record(errors)
        },
      }
    },
  }
}
