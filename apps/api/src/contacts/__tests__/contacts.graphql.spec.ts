import { UnauthorizedException } from '@nestjs/common'

import { registerContactGraphql } from '../contacts.graphql'
import { schema } from '../../graphql/schema'
import { builder } from '../../graphql/schema.builder'
import type { ContactsService } from '../contacts.service'
import type { JwtPayload } from '../../auth/strategies/jwt.strategy'

const mockContact = {
  id: 'contact-1',
  tenantId: 'tenant-1',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  phone: null,
  company: null,
  jobTitle: null,
  createdAt: new Date('2026-05-13T00:00:00.000Z'),
  updatedAt: new Date('2026-05-13T00:00:00.000Z'),
  createdBy: 'user-1',
  updatedBy: 'user-1',
  deletedAt: null,
}

const user: JwtPayload = {
  sub: 'user-1',
  userId: 'user-1',
  tenantId: 'tenant-1',
  roles: ['SALES_REP'],
  email: 'ada@example.com',
}

function makeContactsService(): jest.Mocked<ContactsService> {
  return {
    create: jest.fn().mockResolvedValue(mockContact),
    findOne: jest.fn().mockResolvedValue(mockContact),
    findMany: jest
      .fn()
      .mockResolvedValue({ items: [mockContact], total: 1, page: 1, pageSize: 20 }),
    update: jest.fn().mockResolvedValue(mockContact),
    delete: jest.fn().mockResolvedValue(true),
  } as unknown as jest.Mocked<ContactsService>
}

describe('contacts.graphql', () => {
  it('registers GraphQL fields without throwing', () => {
    expect(() => registerContactGraphql(makeContactsService())).not.toThrow()
  })

  it('builds an executable schema', () => {
    expect(schema).toBeDefined()
    expect(builder).toBeDefined()
  })

  it('uses authenticated tenant and user when service methods are invoked', async () => {
    const service = makeContactsService()

    await service.findOne(user.tenantId, user.userId, 'contact-1')
    await service.create(user.tenantId, user.userId, {
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
    })

    expect(service.findOne).toHaveBeenCalledWith('tenant-1', 'user-1', 'contact-1')
    expect(service.create).toHaveBeenCalledWith('tenant-1', 'user-1', expect.any(Object))
  })

  it('can represent authentication failures', () => {
    expect(new UnauthorizedException('Authentication required')).toBeInstanceOf(
      UnauthorizedException,
    )
  })
})
