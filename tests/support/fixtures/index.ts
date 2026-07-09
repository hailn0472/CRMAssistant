import { test as base } from '@playwright/test'

import { ContactFactory } from './factories/contact-factory'
import { UserFactory } from './factories/user-factory'
import { ApiClient } from '../helpers/api-client'

interface TestFixtures {
  apiClient: ApiClient
  contactFactory: ContactFactory
  userFactory: UserFactory
}

export const test = base.extend<TestFixtures>({
  apiClient: async ({ request }, use): Promise<void> => {
    await use(new ApiClient(request))
  },
  contactFactory: async ({}, use): Promise<void> => {
    const factory = new ContactFactory()
    await use(factory)
    await factory.cleanup()
  },
  userFactory: async ({}, use): Promise<void> => {
    const factory = new UserFactory()
    await use(factory)
    await factory.cleanup()
  },
})

export { expect } from '@playwright/test'
