import { PassThrough, Readable } from 'stream'

import { ExportController } from './export.controller'
import { ExportService } from './export.service'
import type { Response, Request } from 'express'
import type { ExportQueryDto } from './dto/import-result.dto'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

const USER: JwtPayload = {
  sub: 'user-1',
  userId: 'user-1',
  tenantId: 'tenant-1',
  roles: ['ADMIN'],
  email: 'user@example.com',
}

function makeRes(): Response {
  const res = new PassThrough() as unknown as Response
  ;(res.setHeader as unknown as jest.Mock) = jest.fn()
  ;(res.destroy as unknown as jest.Mock) = jest.fn()
  return res
}

function makeController(): {
  controller: ExportController
  exportService: { exportContacts: jest.Mock }
} {
  const exportService = { exportContacts: jest.fn() }
  const controller = new ExportController(exportService as unknown as ExportService)
  return { controller, exportService }
}

describe('ExportController', () => {
  it('sets CSV headers and pipes the stream to the response', async () => {
    const { controller, exportService } = makeController()
    const stream = Readable.from(['a,b\n'])
    exportService.exportContacts.mockResolvedValue(stream)
    const res = makeRes()

    await controller.exportContacts({ user: USER } as unknown as Request, res, {
      tags: 'vip',
      company: 'Acme',
    } as ExportQueryDto)

    expect(exportService.exportContacts).toHaveBeenCalledWith('tenant-1', 'user-1', {
      tags: 'vip',
      company: 'Acme',
      search: undefined,
      jobTitle: undefined,
      createdAtFrom: undefined,
      createdAtTo: undefined,
    })
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8')
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringMatching(/^attachment; filename="contacts-\d{4}-\d{2}-\d{2}\.csv"$/),
    )
    expect(stream.readableFlowing).toBe(true)
  })

  it('destroys the response when the stream errors mid-flight', async () => {
    const { controller, exportService } = makeController()
    const stream = Readable.from(['a,b\n'])
    exportService.exportContacts.mockResolvedValue(stream)
    const res = makeRes()

    await controller.exportContacts({ user: USER } as unknown as Request, res, {} as ExportQueryDto)

    const error = new Error('boom')
    stream.emit('error', error)

    expect(res.destroy).toHaveBeenCalledWith(error)
  })
})
