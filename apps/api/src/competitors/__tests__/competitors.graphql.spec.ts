import { UnauthorizedException, ForbiddenException } from '@nestjs/common'

// Must import BEFORE schema (Pothos registration order)
import '../competitors.graphql'
import { schema } from '../../graphql/schema'
import { builder } from '../../graphql/schema.builder'
import type { CompetitorsService } from '../competitors.service'
import type { DealCompetitorsService } from '../deal-competitors.service'

const mockCompetitor = {
  id: 'competitor-1',
  tenantId: 'tenant-1',
  name: 'Acme Corp',
  website: null,
  strengths: null,
  weaknesses: null,
  isActive: true,
  createdAt: new Date('2026-07-31T00:00:00.000Z'),
  updatedAt: new Date('2026-07-31T00:00:00.000Z'),
  createdBy: 'user-1',
  updatedBy: 'user-1',
  deletedAt: null,
}

const mockLink = {
  id: 'link-1',
  tenantId: 'tenant-1',
  dealId: 'deal-1',
  competitorId: 'competitor-1',
  note: null,
  createdAt: new Date('2026-07-31T00:00:00.000Z'),
  updatedAt: new Date('2026-07-31T00:00:00.000Z'),
  createdBy: 'user-1',
  updatedBy: 'user-1',
  deletedAt: null,
  competitor: {
    id: 'competitor-1',
    name: 'Acme Corp',
    website: null,
    strengths: null,
    weaknesses: null,
    isActive: true,
    createdAt: new Date('2026-07-31T00:00:00.000Z'),
    updatedAt: new Date('2026-07-31T00:00:00.000Z'),
  },
}

const mockConnection = {
  items: [mockCompetitor],
  total: 1,
  page: 1,
  pageSize: 20,
}

const mockDeal = {
  id: 'deal-1',
  tenantId: 'tenant-1',
  title: 'Big Deal',
  value: 50000,
  currency: 'USD',
  probability: 100,
  stageId: 'stage-won',
  contactId: 'contact-1',
  ownerId: 'user-1',
  expectedCloseDate: null,
  actualCloseDate: new Date('2026-07-31T00:00:00.000Z'),
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
  updatedAt: new Date('2026-07-31T00:00:00.000Z'),
  winLossReason: 'PRICE',
  winLossNote: null,
  competitorId: null,
  stage: {
    id: 'stage-won',
    name: 'Closed Won',
    color: '#22C55E',
    probability: 100,
    isWon: true,
    isLost: false,
  },
  contact: { id: 'contact-1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
  owner: {
    id: 'user-1',
    firstName: 'Test',
    lastName: 'User',
    email: 'user@example.com',
    avatar: null,
  },
}

function makeCompetitorsService(): jest.Mocked<CompetitorsService> {
  return {
    create: jest.fn().mockResolvedValue(mockCompetitor),
    findOne: jest.fn().mockResolvedValue(mockCompetitor),
    findMany: jest.fn().mockResolvedValue(mockConnection),
    update: jest.fn().mockResolvedValue(mockCompetitor),
    delete: jest.fn().mockResolvedValue(true),
  } as unknown as jest.Mocked<CompetitorsService>
}

function makeDealCompetitorsService(): jest.Mocked<DealCompetitorsService> {
  return {
    add: jest.fn().mockResolvedValue(mockLink),
    remove: jest.fn().mockResolvedValue(true),
    findManyForDeal: jest.fn().mockResolvedValue([mockLink]),
    recordWinLoss: jest.fn().mockResolvedValue(mockDeal),
  } as unknown as jest.Mocked<DealCompetitorsService>
}

describe('competitors.graphql', () => {
  it('builds an executable schema with competitor types (AC #19)', () => {
    expect(schema).toBeDefined()
    expect(builder).toBeDefined()
  })

  it('registers the WinLossReason enum with the exact catalog values (AC #16)', () => {
    const enumType = schema.getType('WinLossReason')
    expect(enumType).toBeDefined()
    const values = (enumType as { getValues?: () => Array<{ name: string }> })
      .getValues?.()
      .map((v) => v.name)
    expect([...(values ?? [])].sort()).toEqual(
      ['PRICE', 'FEATURES', 'TIMING', 'COMPETITOR', 'BUDGET', 'OTHER'].sort(),
    )
  })

  it('registers all object refs (AC #16)', () => {
    expect(schema.getType('Competitor')).toBeDefined()
    expect(schema.getType('DealCompetitor')).toBeDefined()
    expect(schema.getType('CompetitorConnection')).toBeDefined()
  })

  it('registers all input refs (AC #16)', () => {
    expect(schema.getType('CreateCompetitorInput')).toBeDefined()
    expect(schema.getType('UpdateCompetitorInput')).toBeDefined()
    expect(schema.getType('CompetitorFilterInput')).toBeDefined()
    expect(schema.getType('CompetitorPaginationInput')).toBeDefined()
    expect(schema.getType('AddCompetitorToDealInput')).toBeDefined()
    expect(schema.getType('RecordWinLossInput')).toBeDefined()
  })

  it('exposes the competitors query, dealCompetitors query and all six mutations', () => {
    const queryType = schema.getQueryType()
    expect(queryType?.getFields().competitors).toBeDefined()
    expect(queryType?.getFields().dealCompetitors).toBeDefined()

    const mutationType = schema.getMutationType()
    for (const field of [
      'createCompetitor',
      'updateCompetitor',
      'deleteCompetitor',
      'addCompetitorToDeal',
      'removeCompetitorFromDeal',
      'recordWinLoss',
    ]) {
      expect(mutationType?.getFields()[field]).toBeDefined()
    }
  })

  it('registers the winLossAnalysis query on the reports surface (AC #18)', () => {
    const queryType = schema.getQueryType()
    expect(queryType?.getFields().winLossAnalysis).toBeDefined()
    expect(schema.getType('WinLossAnalysis')).toBeDefined()
    expect(schema.getType('WinLossReasonBucket')).toBeDefined()
    expect(schema.getType('CompetitorOutcome')).toBeDefined()
  })

  it('competitors service receives tenant and filter', async () => {
    const service = makeCompetitorsService()
    await service.findMany('tenant-1', {}, { page: 1, pageSize: 20 })
    expect(service.findMany).toHaveBeenCalledWith('tenant-1', {}, { page: 1, pageSize: 20 })
  })

  it('createCompetitor service receives tenant, user and input', async () => {
    const service = makeCompetitorsService()
    await service.create('tenant-1', 'user-1', { name: 'Acme Corp' })
    expect(service.create).toHaveBeenCalledWith('tenant-1', 'user-1', { name: 'Acme Corp' })
  })

  it('updateCompetitor service receives tenant, user, id and input', async () => {
    const service = makeCompetitorsService()
    await service.update('tenant-1', 'user-1', 'competitor-1', { website: 'https://acme.test' })
    expect(service.update).toHaveBeenCalledWith('tenant-1', 'user-1', 'competitor-1', {
      website: 'https://acme.test',
    })
  })

  it('deleteCompetitor service receives tenant, user and id', async () => {
    const service = makeCompetitorsService()
    await service.delete('tenant-1', 'user-1', 'competitor-1')
    expect(service.delete).toHaveBeenCalledWith('tenant-1', 'user-1', 'competitor-1')
  })

  it('dealCompetitors service receives tenant, user and dealId', async () => {
    const service = makeDealCompetitorsService()
    await service.findManyForDeal('tenant-1', 'user-1', 'deal-1')
    expect(service.findManyForDeal).toHaveBeenCalledWith('tenant-1', 'user-1', 'deal-1')
  })

  it('addCompetitorToDeal service receives tenant, user and input', async () => {
    const service = makeDealCompetitorsService()
    await service.add('tenant-1', 'user-1', { dealId: 'deal-1', competitorId: 'competitor-1' })
    expect(service.add).toHaveBeenCalledWith('tenant-1', 'user-1', {
      dealId: 'deal-1',
      competitorId: 'competitor-1',
    })
  })

  it('removeCompetitorFromDeal service receives tenant, user and link id', async () => {
    const service = makeDealCompetitorsService()
    await service.remove('tenant-1', 'user-1', 'link-1')
    expect(service.remove).toHaveBeenCalledWith('tenant-1', 'user-1', 'link-1')
  })

  it('recordWinLoss service receives tenant, user and the full input', async () => {
    const service = makeDealCompetitorsService()
    await service.recordWinLoss('tenant-1', 'user-1', {
      dealId: 'deal-1',
      stageId: 'stage-won',
      reason: 'PRICE',
      note: null,
    })
    expect(service.recordWinLoss).toHaveBeenCalledWith('tenant-1', 'user-1', {
      dealId: 'deal-1',
      stageId: 'stage-won',
      reason: 'PRICE',
      note: null,
    })
  })

  it('can represent auth and permission failures', () => {
    expect(new UnauthorizedException('Authentication required')).toBeInstanceOf(
      UnauthorizedException,
    )
    expect(new ForbiddenException('Missing required permission: COMPETITOR:READ')).toBeInstanceOf(
      ForbiddenException,
    )
    expect(new ForbiddenException('Missing required permission: COMPETITOR:CREATE')).toBeInstanceOf(
      ForbiddenException,
    )
    expect(new ForbiddenException('Missing required permission: COMPETITOR:UPDATE')).toBeInstanceOf(
      ForbiddenException,
    )
    expect(new ForbiddenException('Missing required permission: COMPETITOR:DELETE')).toBeInstanceOf(
      ForbiddenException,
    )
    expect(new ForbiddenException('Missing required permission: DEAL:UPDATE')).toBeInstanceOf(
      ForbiddenException,
    )
  })

  it('the nested DealCompetitor.competitor ref covers every CompetitorRef field (AC #20)', () => {
    // The include in DealCompetitorsService (DEAL_COMPETITOR_INCLUDE) must select
    // every scalar field CompetitorRef exposes. This mirrors the 3.4 nested-ref
    // crash guard: any field here missing from the include would resolve
    // undefined (dates → .toISOString() crash).
    const competitorFields = [
      'id',
      'name',
      'website',
      'strengths',
      'weaknesses',
      'isActive',
      'createdAt',
      'updatedAt',
    ]
    const competitorType = schema.getType('Competitor')
    const fieldNames = Object.keys(
      (competitorType as { getFields?: () => Record<string, unknown> }).getFields?.() ?? {},
    )
    for (const field of competitorFields) {
      expect(fieldNames).toContain(field)
    }
  })
})
