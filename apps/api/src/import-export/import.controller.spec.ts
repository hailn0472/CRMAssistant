import { NotFoundException } from '@nestjs/common'

import { ImportController } from './import.controller'
import { CsvParserService } from './csv-parser.service'
import { ImportService } from './import.service'
import type { ImportQueryDto } from './dto/import-result.dto'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

const USER: JwtPayload = {
  sub: 'user-1',
  userId: 'user-1',
  tenantId: 'tenant-1',
  roles: ['ADMIN'],
  email: 'user@example.com',
}

function makeFile(originalname = 'contacts.csv'): Express.Multer.File {
  return {
    originalname,
    mimetype: 'text/csv',
    buffer: Buffer.from('email,firstName\njohn@example.com,John\n'),
    size: 42,
  } as Express.Multer.File
}

function makeController(): {
  controller: ImportController
  csvParserService: { parse: jest.Mock }
  importService: {
    startImport: jest.Mock
    previewImport: jest.Mock
    getStatus: jest.Mock
  }
} {
  const csvParserService = { parse: jest.fn() }
  const importService = {
    startImport: jest.fn(),
    previewImport: jest.fn(),
    getStatus: jest.fn(),
  }
  const controller = new ImportController(
    csvParserService as unknown as CsvParserService,
    importService as unknown as ImportService,
  )
  return { controller, csvParserService, importService }
}

describe('ImportController', () => {
  it('returns a preview when confirm is not set', async () => {
    const { controller, csvParserService, importService } = makeController()
    const parsed = {
      rows: [{ email: 'john@example.com', firstName: 'John' }],
      presentColumns: new Set(['email', 'firstName']),
    }
    csvParserService.parse.mockReturnValue(parsed)
    importService.previewImport.mockResolvedValue({
      preview: true,
      totalRows: 1,
      newRows: 1,
      duplicateRows: 0,
      invalidRows: 0,
      previewRows: [],
    })

    const result = await controller.importContacts(
      { user: USER } as never,
      makeFile(),
      {} as ImportQueryDto,
    )

    expect(csvParserService.parse).toHaveBeenCalledWith('email,firstName\njohn@example.com,John\n')
    expect(importService.previewImport).toHaveBeenCalledWith('tenant-1', 'user-1', parsed.rows)
    expect(importService.startImport).not.toHaveBeenCalled()
    expect(result).toEqual({
      preview: true,
      totalRows: 1,
      newRows: 1,
      duplicateRows: 0,
      invalidRows: 0,
      previewRows: [],
    })
  })

  it('starts the import when confirm is true, forwarding the strategy', async () => {
    const { controller, csvParserService, importService } = makeController()
    const parsed = {
      rows: [{ email: 'john@example.com', firstName: 'John' }],
      presentColumns: new Set(['email', 'firstName']),
    }
    csvParserService.parse.mockReturnValue(parsed)
    importService.startImport.mockReturnValue({ importId: 'import-1', totalRows: 1 })

    const result = await controller.importContacts({ user: USER } as never, makeFile(), {
      confirm: true,
      strategy: 'update',
    } as ImportQueryDto)

    expect(importService.startImport).toHaveBeenCalledWith('tenant-1', 'user-1', parsed, 'update')
    expect(importService.previewImport).not.toHaveBeenCalled()
    expect(result).toEqual({ importId: 'import-1', totalRows: 1 })
  })

  it('returns the status when the import exists', async () => {
    const { controller, importService } = makeController()
    const status = {
      importId: 'import-1',
      status: 'running' as const,
      progress: {
        batch: 1,
        totalBatches: 1,
        imported: 0,
        skipped: 0,
        updated: 0,
        failed: 0,
        totalRows: 1,
      },
    }
    importService.getStatus.mockReturnValue(status)

    const result = await controller.getImportStatus({ user: USER } as never, 'import-1')

    expect(importService.getStatus).toHaveBeenCalledWith('import-1', 'tenant-1')
    expect(result).toBe(status)
  })

  it('throws NotFoundException when the import is missing or expired', () => {
    const { controller, importService } = makeController()
    importService.getStatus.mockReturnValue(null)

    // getImportStatus is synchronous — assert the sync throw, not a rejection.
    expect(() => controller.getImportStatus({ user: USER } as never, 'import-1')).toThrow(
      NotFoundException,
    )
  })

  it('serves the CSV template with headers and an example row', () => {
    const { controller } = makeController()

    const { template } = controller.downloadTemplate()

    expect(template).toContain('email,firstName,lastName,phone,company,jobTitle,tags')
    expect(template).toContain('john@example.com')
    expect(template.split('\n')).toHaveLength(2)
  })
})
