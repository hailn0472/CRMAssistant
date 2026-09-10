import { BadRequestException, ForbiddenException } from '@nestjs/common'

import { AuditService } from '../../audit/audit.service'
import { requirePermission } from '../../common/guards/permission-check'
import { GoogleAiStudioClient } from '../google-ai-studio.client'
import { TextToSqlService } from '../text-to-sql.service'

jest.mock('../../common/guards/permission-check', () => ({
  requirePermission: jest.fn(),
}))

describe('TextToSqlService', () => {
  const user = {
    sub: 'user-1',
    userId: 'user-1',
    tenantId: 'tenant-1',
    roles: ['SALES_REP'],
    email: 'sales@example.com',
  }
  const generateJson = jest.fn()
  const log = jest.fn()
  const transactionExecute = jest.fn()
  const transactionQuery = jest.fn()
  const transaction = jest.fn()
  const configGet = jest.fn()
  const requirePermissionMock = jest.mocked(requirePermission)

  function createService(): TextToSqlService {
    return new TextToSqlService(
      { generateJson } as unknown as GoogleAiStudioClient,
      { log } as unknown as AuditService,
      { $transaction: transaction } as never,
      { get: configGet } as never,
    )
  }

  beforeEach(() => {
    jest.clearAllMocks()
    requirePermissionMock.mockResolvedValue(undefined)
    log.mockResolvedValue(undefined)
    configGet.mockReturnValue('test-jwt-secret')
    transaction.mockImplementation(async (callback) =>
      callback({
        $executeRawUnsafe: transactionExecute,
        $queryRawUnsafe: transactionQuery,
      }),
    )
  })

  it('returns a bounded, tenant-scoped preview and audits no raw question', async () => {
    generateJson.mockResolvedValue({
      model: 'gemini-test',
      content: JSON.stringify({
        sql: 'SELECT "id", email FROM "Contact" WHERE "tenantId" = :tenantId AND "deletedAt" IS NULL LIMIT 20',
        explanation: 'Shows active contacts for follow-up.',
        intent: 'CONTACT_FOLLOW_UPS',
      }),
    })

    await expect(
      createService().generatePreview(user, 'Who should I call today?'),
    ).resolves.toEqual(
      expect.objectContaining({
        sql: 'SELECT "id", email FROM "Contact" WHERE "tenantId" = :tenantId AND "deletedAt" IS NULL LIMIT 20',
        explanation: 'Shows active contacts for follow-up.',
        intent: 'CONTACT_FOLLOW_UPS',
        model: 'gemini-test',
        executionToken: expect.any(String),
        status: 'preview',
      }),
    )

    expect(requirePermissionMock).toHaveBeenCalledTimes(3)
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'TEXT_TO_SQL_GENERATED',
        details: { intent: 'CONTACT_FOLLOW_UPS', model: 'gemini-test' },
      }),
    )
    expect(JSON.stringify(log.mock.calls)).not.toContain('Who should I call today?')
  })

  it('rejects malformed provider output and records a rejection audit event', async () => {
    generateJson.mockResolvedValue({ model: 'gemini-test', content: '{bad json' })

    await expect(createService().generatePreview(user, 'bad question')).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(log).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'TEXT_TO_SQL_REJECTED' }),
    )
  })

  it('maps unsafe generated SQL to a safe validation error', async () => {
    generateJson.mockResolvedValue({
      model: 'gemini-test',
      content: JSON.stringify({
        sql: 'DELETE FROM "Contact" WHERE "tenantId" = :tenantId',
        explanation: 'Unsafe.',
        intent: 'CONTACT_FOLLOW_UPS',
      }),
    })

    await expect(createService().generatePreview(user, 'Delete contacts')).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })

  it('preserves an authorization failure while auditing best-effort', async () => {
    requirePermissionMock.mockRejectedValue(new ForbiddenException('Missing permission'))
    log.mockRejectedValue(new Error('audit offline'))

    await expect(createService().generatePreview(user, 'Show my pipeline')).rejects.toBeInstanceOf(
      ForbiddenException,
    )
    expect(generateJson).not.toHaveBeenCalled()
  })

  it('executes only a signed preview in a read-only transaction and returns an assistant response', async () => {
    const previewSql =
      'SELECT "id", email FROM "Contact" WHERE "tenantId" = :tenantId AND "deletedAt" IS NULL LIMIT 20'
    generateJson
      .mockResolvedValueOnce({
        model: 'gemini-test',
        content: JSON.stringify({
          sql: previewSql,
          explanation: 'Shows active contacts for follow-up.',
          intent: 'CONTACT_FOLLOW_UPS',
        }),
      })
      .mockResolvedValueOnce({
        model: 'gemini-test',
        content: JSON.stringify({
          answer: 'There is one contact ready for follow-up.',
          suggestedNextSteps: ['Reach out today.'],
        }),
      })
    transactionExecute.mockResolvedValue(0)
    transactionQuery.mockResolvedValue([{ id: 'contact-1', email: 'ada@example.com' }])
    const service = createService()
    const preview = await service.generatePreview(user, 'Who should I call today?')

    await expect(
      service.executePreview(user, {
        question: 'Who should I call today?',
        sql: preview.sql,
        intent: preview.intent,
        executionToken: preview.executionToken,
      }),
    ).resolves.toEqual({
      answer: 'There is one contact ready for follow-up.',
      suggestedNextSteps: ['Reach out today.'],
      rows: [{ id: 'contact-1', email: 'ada@example.com' }],
      rowCount: 1,
      status: 'completed',
    })

    expect(transactionExecute).toHaveBeenCalledWith('SET TRANSACTION READ ONLY')
    expect(transactionQuery).toHaveBeenCalledWith(previewSql.replace(':tenantId', '$1'), 'tenant-1')
    expect(log).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'TEXT_TO_SQL_EXECUTED' }),
    )
  })
})
