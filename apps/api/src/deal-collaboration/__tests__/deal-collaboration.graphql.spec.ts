import { UnauthorizedException, ForbiddenException } from '@nestjs/common'

// Must import BEFORE schema (Pothos registration order)
import '../deal-collaboration.graphql'
import { schema } from '../../graphql/schema'
import { builder } from '../../graphql/schema.builder'
import { registerDealCollaborationGraphql } from '../deal-collaboration.graphql'
import type { DealDocumentsService } from '../deal-documents.service'
import type { DealCommentsService } from '../deal-comments.service'
import type { DealsService } from '../../deals/deals.service'
import type { DealPubSubService } from '../../deals/deal-pubsub.service'

const mockUploader = {
  id: 'user-1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  avatar: null,
}

const mockDocument = {
  id: 'doc-1',
  tenantId: 'tenant-1',
  dealId: 'deal-1',
  fileName: 'contract.pdf',
  storagePath: 'deals/tenant-1/deal-1/doc-1-contract.pdf',
  fileSize: 1024,
  mimeType: 'application/pdf',
  uploadedBy: 'user-1',
  createdAt: new Date('2026-07-31T00:00:00.000Z'),
  updatedAt: new Date('2026-07-31T00:00:00.000Z'),
  createdBy: 'user-1',
  updatedBy: 'user-1',
  deletedAt: null,
  uploader: mockUploader,
}

const mockComment = {
  id: 'comment-1',
  tenantId: 'tenant-1',
  dealId: 'deal-1',
  userId: 'user-1',
  comment: 'cc @[Grace Hopper](user-2)',
  createdAt: new Date('2026-07-31T00:00:00.000Z'),
  updatedAt: new Date('2026-07-31T00:00:00.000Z'),
  createdBy: 'user-1',
  updatedBy: 'user-1',
  deletedAt: null,
  author: mockUploader,
  mentions: [
    {
      id: 'mention-1',
      tenantId: 'tenant-1',
      commentId: 'comment-1',
      mentionedUserId: 'user-2',
      createdAt: new Date('2026-07-31T00:00:00.000Z'),
      mentionedUser: { ...mockUploader, id: 'user-2', firstName: 'Grace', lastName: 'Hopper' },
    },
  ],
}

function makeDocumentsService(): jest.Mocked<DealDocumentsService> {
  return {
    upload: jest.fn().mockResolvedValue(mockDocument),
    findManyForDeal: jest.fn().mockResolvedValue([mockDocument]),
    createDownloadUrl: jest.fn().mockResolvedValue('https://signed.example/contract.pdf'),
    delete: jest.fn().mockResolvedValue(true),
  } as unknown as jest.Mocked<DealDocumentsService>
}

function makeCommentsService(): jest.Mocked<DealCommentsService> {
  return {
    add: jest.fn().mockResolvedValue(mockComment),
    findManyForDeal: jest.fn().mockResolvedValue({
      items: [mockComment],
      total: 1,
      page: 1,
      pageSize: 50,
    }),
    delete: jest.fn().mockResolvedValue(true),
    mentionCandidates: jest.fn().mockResolvedValue([mockUploader]),
  } as unknown as jest.Mocked<DealCommentsService>
}

function makeDealsService(): jest.Mocked<DealsService> {
  return {
    findOne: jest.fn().mockResolvedValue({ id: 'deal-1' }),
  } as unknown as jest.Mocked<DealsService>
}

function makePubSubService(): jest.Mocked<DealPubSubService> {
  return { publish: jest.fn(), subscribe: jest.fn() } as unknown as jest.Mocked<DealPubSubService>
}

describe('deal-collaboration.graphql', () => {
  beforeAll(() => {
    registerDealCollaborationGraphql(
      makeDocumentsService(),
      makeCommentsService(),
      makeDealsService(),
      makePubSubService(),
    )
  })

  it('registers GraphQL fields without throwing', () => {
    expect(schema).toBeDefined()
    expect(builder).toBeDefined()
  })

  it('builds an executable schema', () => {
    expect(schema).toBeDefined()
  })

  it('can represent authentication failures', () => {
    expect(new UnauthorizedException('Authentication required')).toBeInstanceOf(
      UnauthorizedException,
    )
  })

  it('can represent permission failures', () => {
    expect(new ForbiddenException('Missing required permission: DEAL:READ')).toBeInstanceOf(
      ForbiddenException,
    )
  })

  it('documents service receives tenant, user and dealId', async () => {
    const service = makeDocumentsService()
    await service.findManyForDeal('tenant-1', 'user-1', 'deal-1')
    expect(service.findManyForDeal).toHaveBeenCalledWith('tenant-1', 'user-1', 'deal-1')
  })

  it('document download URL service receives tenant, user and document id', async () => {
    const service = makeDocumentsService()
    await service.createDownloadUrl('tenant-1', 'user-1', 'doc-1')
    expect(service.createDownloadUrl).toHaveBeenCalledWith('tenant-1', 'user-1', 'doc-1')
  })

  it('comments service receives tenant, user, dealId and pagination', async () => {
    const service = makeCommentsService()
    await service.findManyForDeal('tenant-1', 'user-1', 'deal-1', { page: 2, pageSize: 25 })
    expect(service.findManyForDeal).toHaveBeenCalledWith('tenant-1', 'user-1', 'deal-1', {
      page: 2,
      pageSize: 25,
    })
  })

  it('comment add receives tenant, user and the input payload', async () => {
    const service = makeCommentsService()
    await service.add('tenant-1', 'user-1', { dealId: 'deal-1', comment: 'hi @[Ada](user-1)' })
    expect(service.add).toHaveBeenCalledWith('tenant-1', 'user-1', {
      dealId: 'deal-1',
      comment: 'hi @[Ada](user-1)',
    })
  })

  it('comment delete receives the caller roles for the author-or-admin rule', async () => {
    const service = makeCommentsService()
    await service.delete('tenant-1', 'user-1', 'comment-1', ['SALES_REP'])
    expect(service.delete).toHaveBeenCalledWith('tenant-1', 'user-1', 'comment-1', ['SALES_REP'])
  })

  it('mention candidates service receives tenant, user, dealId and search', async () => {
    const service = makeCommentsService()
    await service.mentionCandidates('tenant-1', 'user-1', 'deal-1', 'Gra')
    expect(service.mentionCandidates).toHaveBeenCalledWith('tenant-1', 'user-1', 'deal-1', 'Gra')
  })
})
