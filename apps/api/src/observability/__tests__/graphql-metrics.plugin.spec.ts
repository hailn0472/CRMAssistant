import { Kind, OperationTypeNode } from 'graphql'

import {
  createGraphqlMetricsPlugin,
  normalizeGraphqlOperation,
  normalizeGraphqlStatusClass,
} from '../graphql-metrics.plugin'
import type { GraphqlMetricsPort } from '../metrics.types'

describe('GraphQL metrics normalization', () => {
  it('groups operation kinds without using operation names or query text', () => {
    expect(
      normalizeGraphqlOperation({
        kind: Kind.OPERATION_DEFINITION,
        operation: OperationTypeNode.QUERY,
        selectionSet: { kind: Kind.SELECTION_SET, selections: [] },
      }),
    ).toBe('read')
    expect(
      normalizeGraphqlOperation({
        kind: Kind.OPERATION_DEFINITION,
        operation: OperationTypeNode.MUTATION,
        selectionSet: { kind: Kind.SELECTION_SET, selections: [] },
      }),
    ).toBe('write')
    expect(
      normalizeGraphqlOperation({
        kind: Kind.OPERATION_DEFINITION,
        operation: OperationTypeNode.SUBSCRIPTION,
        selectionSet: { kind: Kind.SELECTION_SET, selections: [] },
      }),
    ).toBe('subscription')
    expect(normalizeGraphqlOperation(undefined)).toBe('other')
  })

  it('maps successful operations and GraphQL errors to status classes', () => {
    expect(normalizeGraphqlStatusClass(undefined)).toBe('2xx')
    expect(normalizeGraphqlStatusClass([{ extensions: { code: 'BAD_USER_INPUT' } }])).toBe('4xx')
    expect(normalizeGraphqlStatusClass([{ extensions: { code: 'INTERNAL_SERVER_ERROR' } }])).toBe(
      '5xx',
    )
  })
})

describe('createGraphqlMetricsPlugin', () => {
  it('records one bounded operation label set and duration', async () => {
    const recordOperation = jest.fn()
    const observeOperationDuration = jest.fn()
    const metrics: GraphqlMetricsPort = { recordOperation, observeOperationDuration }
    const plugin = createGraphqlMetricsPlugin(metrics)
    const listener = await plugin.requestDidStart?.({} as never)
    if (!listener?.didResolveOperation || !listener.willSendResponse) {
      throw new Error('metrics plugin lifecycle is incomplete')
    }

    await listener.didResolveOperation({
      operation: { kind: Kind.OPERATION_DEFINITION, operation: OperationTypeNode.QUERY },
    } as never)
    await listener.willSendResponse({
      response: {
        body: { kind: 'single', singleResult: { data: { privateField: 'not a label' } } },
      },
    } as never)

    expect(recordOperation).toHaveBeenCalledWith({
      operationGroup: 'read',
      statusClass: '2xx',
    })
    expect(observeOperationDuration).toHaveBeenCalledTimes(1)
    expect(observeOperationDuration.mock.calls[0]?.[1]).toEqual(expect.any(Number))
  })

  it('records validation errors as client failures and unknown errors as server failures', async () => {
    const recordOperation = jest.fn()
    const metrics: GraphqlMetricsPort = {
      recordOperation,
      observeOperationDuration: jest.fn(),
    }
    const listener = await createGraphqlMetricsPlugin(metrics).requestDidStart?.({} as never)
    if (!listener?.willSendResponse) throw new Error('metrics plugin lifecycle is incomplete')

    await listener.willSendResponse({
      response: {
        body: {
          kind: 'single',
          singleResult: {
            errors: [{ message: 'invalid input', extensions: { code: 'BAD_USER_INPUT' } }],
          },
        },
      },
    } as never)
    await listener.willSendResponse({
      response: {
        body: {
          kind: 'single',
          singleResult: { errors: [{ message: 'unexpected failure' }] },
        },
      },
    } as never)

    expect(recordOperation).toHaveBeenNthCalledWith(1, {
      operationGroup: 'other',
      statusClass: '4xx',
    })
    expect(recordOperation).toHaveBeenNthCalledWith(2, {
      operationGroup: 'other',
      statusClass: '5xx',
    })
  })
})
