export type Tag = {
  id: string
  name: string
  color: string
  createdAt: string
}

import { graphqlRequest } from '@/lib/graphql-client'

const TAG_FIELDS = `
  id
  name
  color
  createdAt
`

export async function getTags(): Promise<Tag[]> {
  const data = await graphqlRequest<{ tags: Tag[] }>(
    `query Tags {
      tags { ${TAG_FIELDS} }
    }`,
    {},
  )

  return data.tags
}

export async function getContactTags(contactId: string): Promise<Tag[]> {
  const data = await graphqlRequest<{ contactTags: Tag[] }>(
    `query ContactTags($contactId: ID!) {
      contactTags(contactId: $contactId) { ${TAG_FIELDS} }
    }`,
    { contactId },
  )

  return data.contactTags
}

export async function createTag(name: string, color?: string): Promise<Tag> {
  const data = await graphqlRequest<{ createTag: Tag }>(
    `mutation CreateTag($input: CreateTagInput!) {
      createTag(input: $input) { ${TAG_FIELDS} }
    }`,
    { input: { name, color: color ?? undefined } },
  )

  return data.createTag
}

export async function deleteTag(
  id: string,
): Promise<{ success: boolean; affectedContacts: number }> {
  const data = await graphqlRequest<{ deleteTag: { success: boolean; affectedContacts: number } }>(
    `mutation DeleteTag($id: ID!) {
      deleteTag(id: $id) { success affectedContacts }
    }`,
    { id },
  )

  return data.deleteTag
}

export async function updateTag(
  id: string,
  input: { name?: string; color?: string },
): Promise<Tag> {
  const data = await graphqlRequest<{ updateTag: Tag }>(
    `mutation UpdateTag($id: ID!, $input: UpdateTagInput!) {
      updateTag(id: $id, input: $input) { ${TAG_FIELDS} }
    }`,
    { id, input },
  )

  return data.updateTag
}

export async function addTagToContact(contactId: string, tagId: string): Promise<boolean> {
  const data = await graphqlRequest<{ addTagToContact: boolean }>(
    `mutation AddTagToContact($input: AddTagToContactInput!) {
      addTagToContact(input: $input)
    }`,
    { input: { contactId, tagId } },
  )

  return data.addTagToContact
}

export async function removeTagFromContact(contactId: string, tagId: string): Promise<boolean> {
  const data = await graphqlRequest<{ removeTagFromContact: boolean }>(
    `mutation RemoveTagFromContact($input: RemoveTagFromContactInput!) {
      removeTagFromContact(input: $input)
    }`,
    { input: { contactId, tagId } },
  )

  return data.removeTagFromContact
}
