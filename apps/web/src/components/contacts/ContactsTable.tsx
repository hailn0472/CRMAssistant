'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getContacts } from '@/services/contact.service'

const PAGE_SIZE = 10

export function ContactsTable(): React.JSX.Element {
  const [page, setPage] = useState(1)
  const { data, error, isLoading } = useQuery({
    queryKey: ['contacts', page],
    queryFn: () => getContacts(page, PAGE_SIZE),
  })

  if (isLoading) {
    return <p className="text-sm text-slate-300">Loading contacts...</p>
  }

  if (error) {
    return <p className="text-sm text-red-300">Unable to load contacts: {error.message}</p>
  }

  if (!data || data.items.length === 0) {
    return (
      <Card className="border-white/10 bg-white/[0.07] text-white">
        <CardContent className="p-8 text-center">
          <h2 className="text-xl font-semibold">No contacts yet</h2>
          <p className="mt-2 text-sm text-slate-300">
            Create your first contact to build the customer source of truth.
          </p>
          <Button asChild className="mt-5">
            <Link href="/contacts/new">Create contact</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  const totalPages = Math.max(Math.ceil(data.total / data.pageSize), 1)

  return (
    <Card className="border-white/10 bg-white/[0.07] text-white">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Contacts</CardTitle>
        <Button asChild>
          <Link href="/contacts/new">Create contact</Link>
        </Button>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-white/10 text-slate-300">
              <tr>
                <th className="py-3 pr-4 font-medium">Name</th>
                <th className="py-3 pr-4 font-medium">Email</th>
                <th className="py-3 pr-4 font-medium">Company</th>
                <th className="py-3 pr-4 font-medium">Job title</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {data.items.map((contact) => (
                <tr className="hover:bg-white/[0.04]" key={contact.id}>
                  <td className="py-3 pr-4">
                    <Link
                      className="font-medium text-cyan-100 hover:text-cyan-200"
                      href={`/contacts/${contact.id}`}
                    >
                      {contact.firstName} {contact.lastName}
                    </Link>
                  </td>
                  <td className="py-3 pr-4 text-slate-300">{contact.email}</td>
                  <td className="py-3 pr-4 text-slate-300">{contact.company ?? '—'}</td>
                  <td className="py-3 pr-4 text-slate-300">{contact.jobTitle ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-5 flex items-center justify-between text-sm text-slate-300">
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
