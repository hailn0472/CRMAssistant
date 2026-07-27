'use client'

import { 
  Mail, 
  Phone, 
  Calendar, 
  FileText, 
  Briefcase, 
  Sparkles, 
  RefreshCw,
  type LucideIcon,
} from 'lucide-react'
import type { ActivityTypeValue } from '@/types/activity.types'

type IconConfig = {
  icon: LucideIcon
  color: string
  bgColor: string
  label: string
}

const ICON_CONFIGS: Record<ActivityTypeValue, IconConfig> = {
  EMAIL_SENT: {
    icon: Mail,
    color: 'text-blue-600',
    bgColor: 'bg-blue-100',
    label: 'Email Sent',
  },
  CALL_MADE: {
    icon: Phone,
    color: 'text-green-600',
    bgColor: 'bg-green-100',
    label: 'Call Made',
  },
  MEETING_SCHEDULED: {
    icon: Calendar,
    color: 'text-purple-600',
    bgColor: 'bg-purple-100',
    label: 'Meeting Scheduled',
  },
  NOTE_ADDED: {
    icon: FileText,
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-100',
    label: 'Note Added',
  },
  DEAL_CREATED: {
    icon: Briefcase,
    color: 'text-orange-600',
    bgColor: 'bg-orange-100',
    label: 'Deal Created',
  },
  CONTACT_CREATED: {
    icon: Sparkles,
    color: 'text-slate-500',
    bgColor: 'bg-slate-100',
    label: 'Contact Created',
  },
  CONTACT_UPDATED: {
    icon: RefreshCw,
    color: 'text-blue-600',
    bgColor: 'bg-blue-100',
    label: 'Contact Updated',
  },
}

const DEFAULT_CONFIG: IconConfig = {
  icon: FileText,
  color: 'text-slate-500',
  bgColor: 'bg-slate-100',
  label: 'Activity',
}

type ActivityIconProps = {
  type: ActivityTypeValue
  size?: 'sm' | 'md' | 'lg'
}

const SIZE_MAP = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-12 w-12',
}

const ICON_SIZE_MAP = {
  sm: 14,
  md: 18,
  lg: 22,
}

export function ActivityIcon({ type, size = 'md' }: ActivityIconProps): React.JSX.Element {
  const config = ICON_CONFIGS[type] ?? DEFAULT_CONFIG
  const IconComponent = config.icon
  const iconSize = ICON_SIZE_MAP[size]

  return (
    <div
      className={`flex items-center justify-center rounded-full ${config.bgColor} ${SIZE_MAP[size]}`}
      title={config.label}
    >
      <IconComponent className={config.color} size={iconSize} />
    </div>
  )
}

export { ICON_CONFIGS, DEFAULT_CONFIG }
