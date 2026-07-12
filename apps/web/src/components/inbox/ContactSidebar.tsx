import { cn } from '@/lib/utils'
import { Mail, FileText, CheckSquare, CalendarDays, MoreHorizontal } from 'lucide-react'

type Contact = {
  id: string
  firstName: string
  lastName: string
  email: string
}

type ContactSidebarProps = {
  contact?: Contact | null
}

function initials(firstName?: string, lastName?: string): string {
  const first = firstName?.charAt(0) ?? ''
  const last = lastName?.charAt(0) ?? ''
  return (first + last).toUpperCase() || '?'
}

function getRandomColor(str: string): string {
  const colors = [
    'from-blue-500 to-indigo-600',
    'from-emerald-400 to-teal-600',
    'from-orange-400 to-red-500',
    'from-purple-500 to-fuchsia-600',
    'from-pink-500 to-rose-600',
  ]
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash) % colors.length]
}

export function ContactSidebar({ contact }: ContactSidebarProps): React.JSX.Element {
  if (!contact) return <div className="flex-1 bg-white" />

  const fullName = `${contact.firstName} ${contact.lastName}`
  const init = initials(contact.firstName, contact.lastName)
  const colorClass = getRandomColor(fullName)

  return (
    <div className="flex flex-col h-full bg-white overflow-y-auto">
      {/* Profile Section */}
      <div className="flex flex-col items-center p-6 border-b border-slate-100">
        <div
          className={cn(
            'h-20 w-20 rounded-full bg-gradient-to-br flex items-center justify-center text-2xl font-bold text-white shadow-sm ring-4 ring-white mb-4',
            colorClass,
          )}
        >
          {init}
        </div>
        <h2 className="text-[17px] font-bold text-slate-900 tracking-tight">{fullName}</h2>
        <p className="text-[13px] text-slate-500 mt-0.5 font-medium text-center px-4">
          Customer at CRMAssistant
        </p>

        {/* Action Buttons */}
        <div className="flex items-center gap-4 mt-6">
          {[
            { icon: FileText, label: 'Note' },
            { icon: Mail, label: 'Email' },
            { icon: CheckSquare, label: 'Task' },
            { icon: CalendarDays, label: 'Meeting' },
            { icon: MoreHorizontal, label: 'More' },
          ].map((action, i) => (
            <button key={i} className="flex flex-col items-center gap-1.5 group">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-50 text-slate-600 border border-slate-200 group-hover:bg-slate-100 group-hover:text-slate-900 transition-colors">
                <action.icon className="h-4 w-4" />
              </div>
              <span className="text-[11px] font-medium text-slate-500 group-hover:text-slate-700">
                {action.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Details Section */}
      <div className="p-6 flex flex-col gap-6">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center justify-between">
            Contact Details
            <span className="text-slate-400">^</span>
          </h3>

          <div className="space-y-4">
            <div className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-slate-500">Email</span>
              <a
                href={`mailto:${contact.email}`}
                className="text-[14px] text-blue-600 font-medium hover:underline"
              >
                {contact.email}
              </a>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-slate-500">Phone</span>
              <span className="text-[14px] text-blue-600 font-medium cursor-pointer hover:underline">
                +1 (555) 123-4567
              </span>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-slate-500">Location</span>
              <span className="text-[14px] text-slate-900 font-medium">San Francisco, CA</span>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-slate-500">Languages</span>
              <span className="text-[14px] text-slate-900 font-medium">English, Vietnamese</span>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-slate-500">Local Time</span>
              <span className="text-[14px] text-slate-900 font-medium">12:45 PM (PST)</span>
            </div>
          </div>
        </div>

        <div className="h-px bg-slate-100" />

        <div>
          <h3 className="text-sm font-semibold text-slate-900 mb-2">Communication Preferences</h3>
          <p className="text-[12px] text-slate-500 mb-2">
            Manage the types of emails and updates this contact receives.
          </p>
          <button className="text-[13px] text-blue-600 font-medium hover:underline">
            Manage subscriptions
          </button>
        </div>
      </div>
    </div>
  )
}
