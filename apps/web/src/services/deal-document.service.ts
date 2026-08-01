import { graphqlRequest } from '@/lib/graphql-client'

export type DealDocumentUser = {
  id: string
  firstName: string
  lastName: string
  email: string
  avatar?: string | null
}

export type DealDocument = {
  id: string
  dealId: string
  fileName: string
  fileSize: number
  mimeType: string
  uploadedBy: string
  createdAt: string
  uploader: DealDocumentUser
}

const DEAL_DOCUMENT_FIELDS = `
  id
  dealId
  fileName
  fileSize
  mimeType
  uploadedBy
  createdAt
  uploader { id firstName lastName email avatar }
`

export async function getDealDocuments(dealId: string): Promise<DealDocument[]> {
  const data = await graphqlRequest<{ dealDocuments: DealDocument[] }>(
    `query DealDocuments($dealId: ID!) {
      dealDocuments(dealId: $dealId) { ${DEAL_DOCUMENT_FIELDS} }
    }`,
    { dealId },
  )
  return data.dealDocuments
}

export async function getDealDocumentDownloadUrl(id: string): Promise<string> {
  const data = await graphqlRequest<{ dealDocumentDownloadUrl: string }>(
    `query DealDocumentDownloadUrl($id: ID!) {
      dealDocumentDownloadUrl(id: $id)
    }`,
    { id },
  )
  return data.dealDocumentDownloadUrl
}

export async function deleteDealDocument(id: string): Promise<boolean> {
  const data = await graphqlRequest<{ deleteDealDocument: boolean }>(
    `mutation DeleteDealDocument($id: ID!) {
      deleteDealDocument(id: $id)
    }`,
    { id },
  )
  return data.deleteDealDocument
}

/**
 * POSTs the file to the Next.js proxy route, which forwards it to
 * `POST /api/deals/:dealId/documents` with the httpOnly cookie. The upstream
 * error message is rethrown so the drop zone can tell the user what happened
 * (a 413 must say the file is too large, not "Something went wrong").
 */
export async function uploadDealDocument(dealId: string, file: File): Promise<DealDocument> {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(`/api/deals/${dealId}/documents`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null
    throw new Error(payload?.message ?? 'Upload failed')
  }

  return (await response.json()) as DealDocument
}
