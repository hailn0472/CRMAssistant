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
  tasks: 'Tasks',
  // Story 4.4 (AC 39): without this label the breadcrumb renders "Chi tiết".
  activities: 'Activities',
  templates: 'Templates',
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
  'activity-logging': 'Activity Logging',
  // Story 4.3 calendar settings routes.
  calendars: 'Calendars',
  callback: 'Connecting…',
  // Story 4.8 (AC 72): without this label the breadcrumb renders "Chi tiết".
  notifications: 'Notifications',
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
  if (segments.length === 0) return []
  const crumbs: Crumb[] = [{ label: 'CRM', href: '/dashboard' }]
  segments.forEach((segment, index) => {
    crumbs.push({
      label: labelForSegment(segment),
      href: `/${segments.slice(0, index + 1).join('/')}`,
    })
  })
  return crumbs
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
            <Fragment key={`${index}-${crumb.href}`}>
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
