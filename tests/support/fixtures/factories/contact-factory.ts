import { faker } from '@faker-js/faker'

export interface TestContact {
  id: string
  tenantId: string
  email: string
  firstName: string
  lastName: string
  company: string
  phone: string
}

export interface ContactFactoryOptions {
  tenantId?: string
  email?: string
  firstName?: string
  lastName?: string
  company?: string
  phone?: string
}

export class ContactFactory {
  private readonly createdContacts: TestContact[] = []

  create(overrides: ContactFactoryOptions = {}): TestContact {
    const firstName = overrides.firstName ?? faker.person.firstName()
    const lastName = overrides.lastName ?? faker.person.lastName()
    const contact: TestContact = {
      id: faker.string.uuid(),
      tenantId: overrides.tenantId ?? faker.string.uuid(),
      email: overrides.email ?? faker.internet.email({ firstName, lastName }).toLowerCase(),
      firstName,
      lastName,
      company: overrides.company ?? faker.company.name(),
      phone: overrides.phone ?? faker.phone.number(),
    }

    this.createdContacts.push(contact)
    return contact
  }

  created(): TestContact[] {
    return [...this.createdContacts]
  }

  async cleanup(): Promise<void> {
    this.createdContacts.length = 0
  }
}
