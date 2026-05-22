import { UserRole } from '@prisma/client'

import { ApiTestHarness, type GraphqlRequestPayload } from './api-test-harness'

describe('GraphQL API harness', () => {
  let harness: ApiTestHarness

  beforeAll(async () => {
    harness = await ApiTestHarness.start()
  })

  afterAll(async () => {
    await harness.stop()
  })

  afterEach(async () => {
    await harness.cleanupDatabase()
  })

  it('posts a typed GraphQL payload through the real /graphql endpoint', async () => {
    const tenant = await harness.createTenant('GraphQL API Tenant')
    const token = harness.signToken({
      userId: 'graphql-api-user',
      tenantId: tenant.id,
      role: UserRole.SALES_REP,
      email: 'graphql-api-user@example.com',
    })
    const payload: GraphqlRequestPayload = {
      query: `mutation CreateContact($input: CreateContactInput!) {
        createContact(input: $input) { id email firstName lastName }
      }`,
      variables: {
        input: {
          email: 'Ada.GraphQL@Example.com',
          firstName: ' Ada ',
          lastName: ' Lovelace ',
        },
      },
    }

    const createResponse = await harness.graphql(payload, token)

    expect(createResponse.status).toBe(200)
    expect(createResponse.body.errors).toBeUndefined()
    expect(createResponse.body.data.createContact).toMatchObject({
      email: 'ada.graphql@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
    })

    const listPayload: GraphqlRequestPayload = {
      query: `query Contacts($pagination: ContactPaginationInput) {
        contacts(pagination: $pagination) { total items { id email firstName lastName } }
      }`,
      variables: { pagination: { page: 1, pageSize: 10 } },
    }
    const listResponse = await harness.graphql(listPayload, token)

    expect(listResponse.status).toBe(200)
    expect(listResponse.body.errors).toBeUndefined()
    expect(listResponse.body.data.contacts.total).toBe(1)
    expect(listResponse.body.data.contacts.items).toHaveLength(1)
  })
})
