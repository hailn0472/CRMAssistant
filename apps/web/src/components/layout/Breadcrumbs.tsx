'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Fragment } from 'react'

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { cn } from '@/lib/utils'

// Human-readable labels for known route segments. Anything not listed is
// treated as a dynamic segment (record id, etc.) and rendered as "Chi tiết".
const SEGMENT_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  contacts: 'Contacts',
  inbox: 'Inbox',
  users: 'Users',
  settings: 'Settings',
  teams: 'Teams',
  roles: 'Roles',
  'audit-logs': 'Audit Logs',
  'api-keys': 'API Keys',
  channels: 'Channels',
  profile: 'Hồ sơ',
  new: 'Tạo mới',
  edit: 'Chỉnh sửa',
  permissions: 'Phân quyền',
  tags: 'Nhãn',
}

function labelForSegment(segment: string): string {
  return SEGMENT_LABELS[segment] ?? 'Chi tiết'
}

interface Crumb {
  label: string
  href: string
}

function buildCrumbs(pathname: string): Crumb[] {
  const segments = pathname.split('/').filter(Boolean)
  return segments.map((segment, index) => ({
    label: labelForSegment(segment),
    href: `/${segments.slice(0, index + 1).join('/')}`,
  }))
}

export function Breadcrumbs({ className }: { className?: string }): React.JSX.Element | null {
  const pathname = usePathname()
  const crumbs = buildCrumbs(pathname)

  // Nothing meaningful to show at the app root.
  if (crumbs.length === 0) return null

  return (
    <Breadcrumb className={cn('min-w-0', className)}>
      <BreadcrumbList className="flex-nowrap">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1
          return (
            <Fragment key={crumb.href}>
              <BreadcrumbItem className="min-w-0">
                {isLast ? (
                  <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={crumb.href} className="truncate">
                      {crumb.label}
                    </Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator />}
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
