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

  it('serves liveness without dependency details and reports readiness separately', async () => {
    const liveness = await request(harness.app.getHttpServer()).get('/health/live').expect(200)
    expect(liveness.body).toEqual({ status: 'ok' })

    const readiness = await request(harness.app.getHttpServer()).get('/health/ready').expect(200)
    expect(readiness.body).toEqual({
      status: 'degraded',
      dependencies: { postgres: 'ready', redis: 'disabled' },
    })
  })

  it('hides the metrics route completely when observability is disabled', async () => {
    const response = await request(harness.app.getHttpServer()).get('/metrics')

    expect(response.status).toBe(404)
    expect(response.text).not.toContain('crm_')
  })

  it('calls /auth/login without live Supabase services', async () => {
    const tenant = await harness.createTenant('API Auth Tenant')
    await harness.prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: 'login@example.com',
        firstName: 'Login',
        lastName: 'User',
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

  it('returns 400 for invalid /auth/login DTO input before auth execution', async () => {
    const response = await request(harness.app.getHttpServer()).post('/auth/login').send({
      email: 'not-an-email',
      password: '',
      unexpected: 'field',
    })

    expect(response.status).toBe(400)
    expect(response.body.message).toEqual(
      expect.arrayContaining([expect.stringContaining('email')]),
    )
    expect(response.body.message).toEqual(
      expect.arrayContaining([expect.stringContaining('password')]),
    )
    expect(response.body.message).toEqual(
      expect.arrayContaining([expect.stringContaining('unexpected')]),
    )
  })
})
