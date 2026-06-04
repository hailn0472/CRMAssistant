import type { APIRequestContext, APIResponse } from '@playwright/test'

export interface GraphQLRequest<
  TVariables extends Record<string, unknown> = Record<string, unknown>,
> {
  operationName?: string
  query: string
  variables?: TVariables
}

export class ApiClient {
  constructor(private readonly request: APIRequestContext) {}

  async get(path: string): Promise<APIResponse> {
    return this.request.get(path)
  }

  async post<TBody extends Record<string, unknown>>(
    path: string,
    body: TBody,
  ): Promise<APIResponse> {
    return this.request.post(path, { data: body })
  }

  async graphql<TVariables extends Record<string, unknown>>(
    payload: GraphQLRequest<TVariables>,
  ): Promise<APIResponse> {
    return this.request.post('/graphql', { data: payload })
  }
}
