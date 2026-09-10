import { faker } from '@faker-js/faker'

export interface TestUser {
  id: string
  tenantId: string
  email: string
  firstName: string
  lastName: string
  password: string
}

export interface UserFactoryOptions {
  tenantId?: string
  email?: string
  firstName?: string
  lastName?: string
  password?: string
}

export class UserFactory {
  private readonly createdUsers: TestUser[] = []

  create(overrides: UserFactoryOptions = {}): TestUser {
    const firstName = overrides.firstName ?? faker.person.firstName()
    const lastName = overrides.lastName ?? faker.person.lastName()
    const user: TestUser = {
      id: faker.string.uuid(),
      tenantId: overrides.tenantId ?? faker.string.uuid(),
      email: overrides.email ?? faker.internet.email({ firstName, lastName }).toLowerCase(),
      firstName,
      lastName,
      password: overrides.password ?? 'TestPassword123!',
    }

    this.createdUsers.push(user)
    return user
  }

  created(): TestUser[] {
    return [...this.createdUsers]
  }

  async cleanup(): Promise<void> {
    this.createdUsers.length = 0
  }
}
