'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { TableSkeleton } from '@/components/shared/LoadingSkeleton'
import { TagManagementDialog } from '@/components/contacts/TagManagementDialog'
import { getTags, deleteTag } from '@/services/tag.service'

export default function TagsManagementPage(): React.JSX.Element {
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const {
    data: tags = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['tags'],
    queryFn: getTags,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTag(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tags'] })
      void queryClient.invalidateQueries({ queryKey: ['contacts'] })
      setDeleteConfirmId(null)
    },
  })

  if (isLoading) {
    return <TableSkeleton rows={5} columns={3} />
  }

  if (error) {
    return (
      <ErrorState
        message={error instanceof Error ? error.message : 'Unable to load tags.'}
        onRetry={() => refetch()}
      />
    )
  }

  return (
    <>
<Card className="border-slate-200 bg-white text-slate-950 shadow-sm">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-lg">Tags</CardTitle>
          <TagManagementDialog
            trigger={
              <Button className="bg-slate-950 text-white hover:bg-slate-800" type="button">
                Create tag
              </Button>
            }
          />
        </CardHeader>
        <CardContent>
          {tags.length === 0 ? (
            <EmptyState
              title="No tags yet"
              description="Create tags to organize and filter your contacts."
              action={
                <TagManagementDialog
                  trigger={
                    <Button className="bg-slate-950 text-white hover:bg-slate-800" type="button">
                      Create your first tag
                    </Button>
                  }
                />
              }
            />
          ) : (
            <div className="divide-y divide-slate-100">
              {tags.map((tag) => (
                <div key={tag.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <div className="h-4 w-4 rounded-full" style={{ backgroundColor: tag.color }} />
                    <span className="text-sm font-medium text-slate-700">{tag.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {deleteConfirmId === tag.id ? (
                      <>
                        <Button
                          className="h-8 text-xs"
                          onClick={() => void deleteMutation.mutateAsync(tag.id)}
                          type="button"
                          variant="destructive"
                          size="sm"
                        >
                          Confirm delete
                        </Button>
                        <Button
                          className="h-8 text-xs"
                          onClick={() => setDeleteConfirmId(null)}
                          type="button"
                          variant="ghost"
                          size="sm"
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button
                        className="h-8 text-xs text-red-600 hover:text-red-700"
                        onClick={() => setDeleteConfirmId(tag.id)}
                        type="button"
                        variant="ghost"
                        size="sm"
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  )
}
