import { TextToSqlController } from '../text-to-sql.controller'
import { TextToSqlService } from '../text-to-sql.service'

describe('TextToSqlController', () => {
  it('delegates a validated question to the preview service for the current user', async () => {
    const generatePreview = jest.fn().mockResolvedValue({ status: 'preview' })
    const executePreview = jest.fn().mockResolvedValue({ status: 'completed' })
    const controller = new TextToSqlController({
      generatePreview,
      executePreview,
    } as unknown as TextToSqlService)
    const user = {
      sub: 'user-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      roles: ['ADMIN'],
      email: 'admin@example.com',
    }

    await expect(controller.preview(user, { question: 'Show overdue tasks' })).resolves.toEqual({
      status: 'preview',
    })
    expect(generatePreview).toHaveBeenCalledWith(user, 'Show overdue tasks')
    await expect(
      controller.execute(user, {
        question: 'Show overdue tasks',
        sql: 'SELECT "id" FROM "Task" WHERE "tenantId" = :tenantId LIMIT 10',
        intent: 'OVERDUE_TASKS',
        executionToken: 'signed-preview',
      }),
    ).resolves.toEqual({ status: 'completed' })
    expect(executePreview).toHaveBeenCalledWith(
      user,
      expect.objectContaining({ executionToken: 'signed-preview' }),
    )
  })
})
