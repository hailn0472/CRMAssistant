import { graphqlRequest } from '@/lib/graphql-client'

export type FacebookPageConnection = {
  id: string
  tenantId: string
  channel: string
  externalId: string
  displayName: string | null
  status: string
  createdAt: string
  updatedAt: string
}

function assertData<T>(data: T | null | undefined, name: string): T {
  if (data == null) throw new Error(`FacebookService: ${name} returned null`)
  return data
}

const FACEBOOK_PAGE_FIELDS = `
  id
  tenantId
  channel
  externalId
  displayName
  status
  createdAt
  updatedAt
`

export async function getFacebookPages(): Promise<FacebookPageConnection[]> {
  const data = await graphqlRequest<{ facebookPages: FacebookPageConnection[] }>(
    `query FacebookPages {
      facebookPages { ${FACEBOOK_PAGE_FIELDS} }
    }`,
    {},
  )
  return assertData(data.facebookPages, 'facebookPages')
}

export async function connectFacebookPage(input: {
  pageId: string
  accessToken: string
  displayName?: string
}): Promise<FacebookPageConnection> {
  const data = await graphqlRequest<{ connectFacebookPage: FacebookPageConnection }>(
    `mutation ConnectFacebookPage($input: ConnectFacebookPageInput!) {
      connectFacebookPage(input: $input) { ${FACEBOOK_PAGE_FIELDS} }
    }`,
    { input },
  )
  return assertData(data.connectFacebookPage, 'connectFacebookPage')
}

export async function disconnectFacebookPage(pageId: string): Promise<boolean> {
  const data = await graphqlRequest<{ disconnectFacebookPage: boolean }>(
    `mutation DisconnectFacebookPage($pageId: String!) {
      disconnectFacebookPage(pageId: $pageId)
    }`,
    { pageId },
  )
  if (data.disconnectFacebookPage == null) {
    throw new Error('FacebookService: disconnectFacebookPage returned null')
  }
  return data.disconnectFacebookPage
}
