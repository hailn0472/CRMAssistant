import request from 'supertest'

import { ApiTestHarness } from './api-test-harness'

const SUPABASE_UID = '55555555-5555-5555-5555-555555555555'

describe('REST API harness', () => {
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

  it('calls /health through the real NestJS app', async () => {
    const response = await request(harness.app.getHttpServer()).get('/health').expect(200)

    expect(response.body).toEqual({ status: 'ok' })
  })

  it('calls /auth/login without live Supabase services', async () => {
    const tenant = await harness.createTenant('API Auth Tenant')
    await harness.prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: 'login@example.com',
        name: 'Login User',
        supabaseUserId: SUPABASE_UID,
        createdBy: 'api-test',
        updatedBy: 'api-test',
      },
    })
    ApiTestHarness.mockSupabaseSuccessfulSignIn(SUPABASE_UID)

    const response = await request(harness.app.getHttpServer()).post('/auth/login').send({
      email: 'login@example.com',
      password: 'Password123',
    })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      accessToken: expect.any(String),
      email: 'login@example.com',
      tenantId: tenant.id,
    })
  })

  it('returns 401 for rejected /auth/login credentials without calling live Supabase', async () => {
    ApiTestHarness.mockSupabaseRejectedSignIn('Invalid login credentials')

    const response = await request(harness.app.getHttpServer()).post('/auth/login').send({
      email: 'missing@example.com',
      password: 'WrongPassword123',
    })

    expect(response.status).toBe(401)
  })
})
