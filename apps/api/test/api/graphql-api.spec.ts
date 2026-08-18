import { ApiTestHarness, type GraphqlRequestPayload } from './api-test-harness'

/** Walk NON_NULL/LIST wrappers to the underlying named introspection type. */
function unwrapNamedType(
  type: {
    name: string | null
    kind: string
    ofType?: { name: string | null; kind: string; ofType?: unknown } | null
  } | null,
): string | null {
  if (!type) return null
  if (type.name) return type.name
  return unwrapNamedType((type.ofType as typeof type | null) ?? null)
}

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

  it('rejects contact queries without a signed JWT', async () => {
    const payload: GraphqlRequestPayload = {
      query: `query Contacts($pagination: ContactPaginationInput) {
        contacts(pagination: $pagination) { total items { id email firstName lastName } }
      }`,
      variables: { pagination: { page: 1, pageSize: 10 } },
    }

    const response = await harness.graphql(payload)

    expect(response.status).toBe(200)
    expect(response.body.data?.contacts).toBeNull()
    expect(response.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringMatching(/authentication|required|unauthorized/i),
        }),
      ]),
    )
  })

  it('documents current GraphQL authorization behavior for signed user roles', async () => {
    const tenant = await harness.createTenant('GraphQL Role Smoke Tenant')
    const userId = 'graphql-role-smoke-user'
    await harness.prisma.user.create({
      data: {
        id: userId,
        tenantId: tenant.id,
        email: 'graphql-role-smoke-user@example.com',
        firstName: 'Smoke',
        lastName: 'User',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    const role = await harness.prisma.role.create({
      data: {
        tenantId: tenant.id,
        name: 'ADMIN',
        isSystem: true,
        dataVisibility: 'ALL',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    await harness.prisma.userRole.create({ data: { userId, roleId: role.id, assignedBy: 'test' } })
    const token = harness.signToken({
      userId,
      tenantId: tenant.id,
      roles: ['ADMIN'],
      email: 'graphql-role-smoke-user@example.com',
    })
    const payload: GraphqlRequestPayload = {
      query: `query Contacts($pagination: ContactPaginationInput) {
        contacts(pagination: $pagination) { total items { id email firstName lastName } }
      }`,
      variables: { pagination: { page: 1, pageSize: 10 } },
    }

    const response = await harness.graphql(payload, token)

    expect(response.status).toBe(200)
    expect(response.body.errors).toBeUndefined()
    expect(response.body.data.contacts.items).toEqual([])
  })

  it('posts a typed GraphQL payload through the real /graphql endpoint', async () => {
    const tenant = await harness.createTenant('GraphQL API Tenant')
    const userId = 'graphql-api-user'
    // Create user + role + userRole for FK and visibility check
    await harness.prisma.user.create({
      data: {
        id: userId,
        tenantId: tenant.id,
        email: 'graphql-api-user@example.com',
        firstName: 'Test',
        lastName: 'User',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    const role = await harness.prisma.role.create({
      data: {
        tenantId: tenant.id,
        name: 'ADMIN',
        isSystem: true,
        dataVisibility: 'ALL',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    await harness.prisma.userRole.create({ data: { userId, roleId: role.id, assignedBy: 'test' } })
    const token = harness.signToken({
      userId,
      tenantId: tenant.id,
      roles: ['ADMIN'],
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

  it('keeps tenant-scoped contact data isolated between GraphQL users', async () => {
    const [tenantA, tenantB] = await Promise.all([
      harness.createTenant('Tenant Isolation A'),
      harness.createTenant('Tenant Isolation B'),
    ])
    // Create users + roles for FK and visibility check in both tenants
    const userAId = 'tenant-a-user'
    const userBId = 'tenant-b-user'
    await harness.prisma.user.create({
      data: {
        id: userAId,
        tenantId: tenantA.id,
        email: 'tenant-a-user@example.com',
        firstName: 'A',
        lastName: 'User',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    const roleA = await harness.prisma.role.create({
      data: {
        tenantId: tenantA.id,
        name: 'ADMIN',
        isSystem: true,
        dataVisibility: 'ALL',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    await harness.prisma.userRole.create({
      data: { userId: userAId, roleId: roleA.id, assignedBy: 'test' },
    })
    await harness.prisma.user.create({
      data: {
        id: userBId,
        tenantId: tenantB.id,
        email: 'tenant-b-user@example.com',
        firstName: 'B',
        lastName: 'User',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    const roleB = await harness.prisma.role.create({
      data: {
        tenantId: tenantB.id,
        name: 'ADMIN',
        isSystem: true,
        dataVisibility: 'ALL',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    await harness.prisma.userRole.create({
      data: { userId: userBId, roleId: roleB.id, assignedBy: 'test' },
    })
    const tenantAToken = harness.signToken({
      userId: userAId,
      tenantId: tenantA.id,
      roles: ['ADMIN'],
      email: 'tenant-a-user@example.com',
    })
    const tenantBToken = harness.signToken({
      userId: userBId,
      tenantId: tenantB.id,
      roles: ['ADMIN'],
      email: 'tenant-b-user@example.com',
    })
    const createTenantAContactMutation: GraphqlRequestPayload = {
      query: `mutation CreateContact($input: CreateContactInput!) {
        createContact(input: $input) { id email firstName lastName }
      }`,
      variables: {
        input: {
          email: 'tenant-a-contact@example.com',
          firstName: 'Tenant',
          lastName: 'A',
        },
      },
    }
    const createTenantBContactMutation: GraphqlRequestPayload = {
      query: `mutation CreateContact($input: CreateContactInput!) {
        createContact(input: $input) { id email firstName lastName }
      }`,
      variables: {
        input: {
          email: 'tenant-b-contact@example.com',
          firstName: 'Tenant',
          lastName: 'B',
        },
      },
    }
    const listContactsQuery: GraphqlRequestPayload = {
      query: `query Contacts($pagination: ContactPaginationInput) {
        contacts(pagination: $pagination) { total items { id email firstName lastName } }
      }`,
      variables: { pagination: { page: 1, pageSize: 10 } },
    }

    const tenantACreateResponse = await harness.graphql(createTenantAContactMutation, tenantAToken)
    const tenantBCreateResponse = await harness.graphql(createTenantBContactMutation, tenantBToken)
    const tenantAListResponse = await harness.graphql(listContactsQuery, tenantAToken)
    const tenantBListResponse = await harness.graphql(listContactsQuery, tenantBToken)

    expect(tenantACreateResponse.status).toBe(200)
    expect(tenantACreateResponse.body.errors).toBeUndefined()
    expect(tenantBCreateResponse.status).toBe(200)
    expect(tenantBCreateResponse.body.errors).toBeUndefined()
    expect(tenantAListResponse.status).toBe(200)
    expect(tenantAListResponse.body.errors).toBeUndefined()
    expect(tenantAListResponse.body.data.contacts.items).toEqual([
      expect.objectContaining({ email: 'tenant-a-contact@example.com' }),
    ])
    expect(tenantAListResponse.body.data.contacts.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ email: 'tenant-b-contact@example.com' })]),
    )
    expect(tenantBListResponse.status).toBe(200)
    expect(tenantBListResponse.body.errors).toBeUndefined()
    expect(tenantBListResponse.body.data.contacts.items).toEqual([
      expect.objectContaining({ email: 'tenant-b-contact@example.com' }),
    ])
    expect(tenantBListResponse.body.data.contacts.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ email: 'tenant-a-contact@example.com' })]),
    )
  })

  it('exposes the exact Story 6.6 report-export SDL surface (enums, mutation args, download type)', async () => {
    const payload: GraphqlRequestPayload = {
      query: `
        query {
          __schema {
            mutationType { fields { name type { kind ofType { name } } args { name type { kind name ofType { name } } } } }
            queryType { fields { name type { kind ofType { name } } } }
            types { name fields { name } }
          }
        }
      `,
    }
    const response = await harness.graphql(payload)
    expect(response.body.errors).toBeUndefined()
    const schema = response.body.data.__schema

    const mutations = schema.mutationType.fields
    const exportMutation = mutations.find((f: { name: string }) => f.name === 'exportReport')
    expect(exportMutation).toBeDefined()
    const argNames = exportMutation.args.map((a: { name: string }) => a.name)
    expect(argNames.sort()).toEqual(['filters', 'format', 'reportId'])
    const formatArg = exportMutation.args.find((a: { name: string }) => a.name === 'format')
    expect(formatArg.type.kind).toBe('NON_NULL')
    expect(unwrapNamedType(formatArg.type)).toBe('ReportDeliveryFormat')
    const filtersArg = exportMutation.args.find((a: { name: string }) => a.name === 'filters')
    expect(filtersArg.type.name).toBe('ReportFiltersInput')
    expect(filtersArg.type.kind).toBe('INPUT_OBJECT')
    const reportIdArg = exportMutation.args.find((a: { name: string }) => a.name === 'reportId')
    expect(reportIdArg.type.kind).toBe('NON_NULL')
    expect(unwrapNamedType(reportIdArg.type)).toBe('ID')
    // Contract B7 non-nullability: exportReport → ReportExport!
    expect(exportMutation.type.kind).toBe('NON_NULL')
    expect(unwrapNamedType(exportMutation.type)).toBe('ReportExport')

    const downloadMutation = mutations.find(
      (f: { name: string }) => f.name === 'reportExportDownloadUrl',
    )
    expect(downloadMutation).toBeDefined()
    expect(downloadMutation.type.kind).toBe('NON_NULL')
    expect(unwrapNamedType(downloadMutation.type)).toBe('ReportExportDownload')
    const deleteMutation = mutations.find((f: { name: string }) => f.name === 'deleteReportExport')
    expect(deleteMutation).toBeDefined()
    expect(deleteMutation.type.kind).toBe('NON_NULL')
    expect(unwrapNamedType(deleteMutation.type)).toBe('Boolean')

    const queries = schema.queryType.fields
    const reportExportsQuery = queries.find((f: { name: string }) => f.name === 'reportExports')
    expect(reportExportsQuery).toBeDefined()
    expect(reportExportsQuery.type.kind).toBe('NON_NULL')
    expect(unwrapNamedType(reportExportsQuery.type)).toBe('ReportExportConnection')
    const reportExportQuery = queries.find((f: { name: string }) => f.name === 'reportExport')
    expect(reportExportQuery).toBeDefined()
    expect(reportExportQuery.type.kind).toBe('NON_NULL')
    expect(unwrapNamedType(reportExportQuery.type)).toBe('ReportExport')

    const typeNames = schema.types.map((t: { name: string }) => t.name)
    expect(typeNames).toContain('ReportExport')
    expect(typeNames).toContain('ReportExportConnection')
    expect(typeNames).toContain('ReportExportDownload')
    expect(typeNames).toContain('ReportExportStatus')
    expect(typeNames).toContain('ReportDeliveryFormat')
    // Contract B7: single shared enum — the duplicate ReportExportFormat must not exist.
    expect(typeNames).not.toContain('ReportExportFormat')
    expect(typeNames).toContain('PaginationInput')

    // Contract B7 field secrecy: no filters/objectPath/storage internals leak.
    const exportType = schema.types.find((t: { name: string }) => t.name === 'ReportExport')
    const exportFieldNames = exportType.fields.map((f: { name: string }) => f.name)
    expect(exportFieldNames).toEqual(
      expect.arrayContaining([
        'id',
        'status',
        'format',
        'filterSummary',
        'dateRangeStart',
        'dateRangeEnd',
        'filename',
        'contentType',
        'fileSizeBytes',
        'attemptCount',
        'errorCode',
        'errorMessage',
        'createdAt',
        'completedAt',
        'report',
      ]),
    )
    expect(exportFieldNames).not.toContain('filters')
    expect(exportFieldNames).not.toContain('objectPath')
  })
})
