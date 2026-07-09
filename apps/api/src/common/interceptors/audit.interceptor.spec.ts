import { of } from 'rxjs'
import type { CallHandler } from '@nestjs/common'
import { AuditInterceptor } from './audit.interceptor'
import type { AuditService } from '../../audit/audit.service'

// Mock GqlExecutionContext
const mockGqlCtx = {
  getInfo: jest.fn(),
  getContext: jest.fn(),
  getArgs: jest.fn(),
}

jest.mock('@nestjs/graphql', () => ({
  GqlExecutionContext: {
    create: jest.fn(() => mockGqlCtx),
  },
}))

describe('AuditInterceptor', () => {
  let interceptor: AuditInterceptor
  let auditService: { log: jest.Mock }

  beforeEach(() => {
    jest.clearAllMocks()
    auditService = { log: jest.fn().mockResolvedValue(undefined) }
    interceptor = new AuditInterceptor(auditService as unknown as AuditService)
  })

  it('skips query operations (not mutations)', () => {
    mockGqlCtx.getInfo.mockReturnValue({ fieldName: 'contacts', parentType: { name: 'Query' } })
    mockGqlCtx.getContext.mockReturnValue({ req: { headers: {} }, user: null })

    const callHandler: CallHandler = { handle: () => of({ id: '1' }) }
    interceptor.intercept({} as never, callHandler)

    expect(auditService.log).not.toHaveBeenCalled()
  })

  it('skips unknown mutations not in the audit map', () => {
    mockGqlCtx.getInfo.mockReturnValue({
      fieldName: 'unknownMutation',
      parentType: { name: 'Mutation' },
    })
    mockGqlCtx.getContext.mockReturnValue({
      req: { headers: {} },
      user: { userId: 'user-1', tenantId: 'tenant-1' },
    })

    const callHandler: CallHandler = { handle: () => of({ id: '1' }) }
    interceptor.intercept({} as never, callHandler)

    expect(auditService.log).not.toHaveBeenCalled()
  })

  it('calls auditService.log for known CRUD mutations', (done) => {
    mockGqlCtx.getInfo.mockReturnValue({
      fieldName: 'createContact',
      parentType: { name: 'Mutation' },
    })
    mockGqlCtx.getContext.mockReturnValue({
      req: {
        headers: { 'x-forwarded-for': '192.168.1.1', 'user-agent': 'Mozilla/5.0' },
      },
      user: { userId: 'user-1', tenantId: 'tenant-1' },
    })

    const callHandler: CallHandler = { handle: () => of({ id: 'contact-1' }) }

    const result$ = interceptor.intercept({} as never, callHandler)

    result$.subscribe({
      complete: () => {
        try {
          expect(auditService.log).toHaveBeenCalledWith(
            expect.objectContaining({
              tenantId: 'tenant-1',
              userId: 'user-1',
              action: 'CREATE',
              entity: 'CONTACT',
              entityId: 'contact-1',
              ipAddress: '192.168.1.1',
              userAgent: 'Mozilla/5.0',
            }),
          )
          done()
        } catch (err) {
          done(err)
        }
      },
    })
  })

  it('captures IP from x-forwarded-for header', (done) => {
    mockGqlCtx.getInfo.mockReturnValue({
      fieldName: 'createContact',
      parentType: { name: 'Mutation' },
    })
    mockGqlCtx.getContext.mockReturnValue({
      req: { headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' } },
      user: { userId: 'user-1', tenantId: 'tenant-1' },
    })

    const callHandler: CallHandler = { handle: () => of({ id: 'contact-1' }) }
    const result$ = interceptor.intercept({} as never, callHandler)

    result$.subscribe({
      complete: () => {
        try {
          expect(auditService.log).toHaveBeenCalledWith(
            expect.objectContaining({ ipAddress: '10.0.0.1' }),
          )
          done()
        } catch (err) {
          done(err)
        }
      },
    })
  })

  it('does not break the mutation flow when audit logging fails', (done) => {
    mockGqlCtx.getInfo.mockReturnValue({
      fieldName: 'createContact',
      parentType: { name: 'Mutation' },
    })
    mockGqlCtx.getContext.mockReturnValue({
      req: { headers: {} },
      user: { userId: 'user-1', tenantId: 'tenant-1' },
    })
    auditService.log.mockRejectedValue(new Error('DB error'))

    const callHandler: CallHandler = { handle: () => of({ id: 'contact-1' }) }
    const result$ = interceptor.intercept({} as never, callHandler)

    result$.subscribe({
      complete: () => done(),
      error: (err) => done(err),
    })
  })

  it('handles API key mutations', (done) => {
    mockGqlCtx.getInfo.mockReturnValue({
      fieldName: 'createApiKey',
      parentType: { name: 'Mutation' },
    })
    mockGqlCtx.getContext.mockReturnValue({
      req: { headers: {} },
      user: { userId: 'user-1', tenantId: 'tenant-1' },
    })
    mockGqlCtx.getArgs.mockReturnValue({})

    const callHandler: CallHandler = { handle: () => of({ id: 'key-1' }) }
    const result$ = interceptor.intercept({} as never, callHandler)

    result$.subscribe({
      complete: () => {
        try {
          expect(auditService.log).toHaveBeenCalledWith(
            expect.objectContaining({
              action: 'API_KEY_CREATED',
              entity: 'API_KEY',
            }),
          )
          done()
        } catch (err) {
          done(err)
        }
      },
    })
  })
})
