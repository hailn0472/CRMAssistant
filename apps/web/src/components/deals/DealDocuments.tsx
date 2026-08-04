'use client'

import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'

import {
  getDealDocuments,
  deleteDealDocument,
  getDealDocumentDownloadUrl,
} from '@/services/deal-document.service'
import type { DealDocument } from '@/services/deal-document.service'
import { formatFileSize, fileKindLabel } from '@/lib/deal-document-format'
import { ResponsiveTableWrapper } from '@/components/shared/ResponsiveTableWrapper'
import { ErrorState } from '@/components/shared/ErrorState'
import { TableSkeleton } from '@/components/shared/LoadingSkeleton'
import { usePermission } from '@/hooks/usePermission'
import { DealDocumentUpload } from './DealDocumentUpload'

/**
 * Deal document list (AC 39). Renders for anyone who can open the deal; the
 * upload zone and delete affordance are additionally gated on DEAL:UPDATE
 * (AC 47) — the server gates remain the authority, this is UX only.
 */
export function DealDocuments({ dealId }: { dealId: string }): React.JSX.Element {
  const router = useRouter()
  const queryClient = useQueryClient()
  const canUpdate = usePermission('DEAL', 'UPDATE')

  const {
    data: documents,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['dealDocuments', dealId],
    queryFn: () => getDealDocuments(dealId),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDealDocument(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dealDocuments', dealId] })
      router.refresh()
      toast.success('Document deleted')
    },
    onError: () => {
      toast.error('Failed to delete document')
    },
  })

  const handleDownload = async (document: DealDocument): Promise<void> => {
    try {
      // The anchor href is never a stored URL — mint a fresh signed URL per click.
      const url = await getDealDocumentDownloadUrl(document.id)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      toast.error('Failed to generate download link')
    }
  }

  const handleDelete = (document: DealDocument): void => {
    if (!confirm(`Delete ${document.fileName}?`)) return
    deleteMutation.mutate(document.id)
  }

  if (isLoading) return <TableSkeleton />

  return (
    <div className="px-[18px] pt-[14px] pb-[18px]">
      {canUpdate ? <DealDocumentUpload dealId={dealId} /> : null}

      {error ? (
        <div className="mt-4">
          <ErrorState message="Failed to load documents" />
        </div>
      ) : documents && documents.length > 0 ? (
        <div className="mt-4">
          <ResponsiveTableWrapper>
            <table className="w-full text-sm">
              <caption className="sr-only">Documents attached to this deal</caption>
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <th scope="col" className="px-4 py-3">
                    File name
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Type
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Size
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Uploaded by
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Date
                  </th>
                  <th scope="col" className="px-4 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {documents.map((document) => (
                  <tr key={document.id} className="border-b border-slate-100">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => handleDownload(document)}
                        className="inline-flex items-center gap-1.5 font-medium text-indigo-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {document.fileName}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{fileKindLabel(document.mimeType)}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatFileSize(document.fileSize)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {document.uploader.firstName} {document.uploader.lastName}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {new Date(document.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canUpdate ? (
                        <button
                          type="button"
                          aria-label={`Delete ${document.fileName}`}
                          onClick={() => handleDelete(document)}
                          className="inline-flex h-11 w-11 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTableWrapper>
        </div>
      ) : null}
    </div>
  )
}
