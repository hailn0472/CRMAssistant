'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { ResponsiveTableWrapper } from '@/components/shared/ResponsiveTableWrapper'
import { TableSkeleton } from '@/components/shared/LoadingSkeleton'
import { getContacts } from '@/services/contact.service'

const PAGE_SIZE = 10

export function ContactsTable(): React.JSX.Element {
  const [page, setPage] = useState(1)
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ['contacts', page],
    queryFn: () => getContacts(page, PAGE_SIZE),
  })

  if (isLoading) {
    return <TableSkeleton rows={5} columns={4} />
  }

  if (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unable to load contacts.'

    return <ErrorState message={errorMessage} onRetry={() => refetch()} />
  }

  if (!data || data.items.length === 0) {
    return (
      <EmptyState
        title="No contacts yet"
        description="Create your first contact to build the customer source of truth."
        action={
          <Button asChild className="bg-slate-950 text-white hover:bg-slate-800">
            <Link href="/contacts/new">Create contact</Link>
          </Button>
        }
      />
    )
  }

  const totalPages = Math.max(Math.ceil(data.total / data.pageSize), 1)

  return (
    <Card className="border-slate-200 bg-white text-slate-950 shadow-sm">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-lg">Contacts</CardTitle>
        <Button asChild className="bg-slate-950 text-white hover:bg-slate-800">
          <Link href="/contacts/new">Create contact</Link>
        </Button>
      </CardHeader>
      <CardContent>
        <ResponsiveTableWrapper>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th className="sticky left-0 z-10 bg-slate-50 py-3 pr-4 pl-4 font-medium shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                  Name
                </th>
                <th className="py-3 pr-4 font-medium">Email</th>
                <th className="py-3 pr-4 font-medium">Company</th>
                <th className="py-3 pr-4 font-medium">Job title</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((contact) => (
                <tr className="group hover:bg-slate-50" key={contact.id}>
                  <td className="sticky left-0 z-10 bg-white py-3 pr-4 pl-4 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)] group-hover:bg-slate-50">
                    <Link
                      className="font-medium text-blue-700 hover:text-blue-800 hover:underline"
                      href={`/contacts/${contact.id}`}
                    >
                      {contact.firstName} {contact.lastName}
                    </Link>
                  </td>
                  <td className="py-3 pr-4 text-slate-600">{contact.email}</td>
                  <td className="py-3 pr-4 text-slate-600">{contact.company ?? '-'}</td>
                  <td className="py-3 pr-4 text-slate-600">{contact.jobTitle ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ResponsiveTableWrapper>
        <div className="mt-5 flex items-center justify-between text-sm text-slate-600">
          <span>
            Page {data.page} of {totalPages} · {data.total} contacts
          </span>
          <div className="flex gap-2">
            <Button
              disabled={page === 1}
              onClick={() => setPage((current) => current - 1)}
              type="button"
              variant="outline"
            >
              Previous
            </Button>
            <Button
              disabled={page >= totalPages}
              onClick={() => setPage((current) => current + 1)}
              type="button"
              variant="outline"
            >
              Next
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
