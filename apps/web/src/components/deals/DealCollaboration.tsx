'use client'

import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { DealTimeline } from './DealTimeline'
import { DealDocuments } from './DealDocuments'
import { DealComments } from './DealComments'
import { NotesPanel } from '@/components/notes/NotesPanel'
import { getDealDocuments } from '@/services/deal-document.service'
import { getDealComments } from '@/services/deal-comment.service'
import { getNotes } from '@/services/note.service'

/**
 * Three-tab Collaboration block (Timeline | Documents | Comments) for the deal detail page
 * matching prototype CRM.dc.html.
 */
const TABS = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'documents', label: 'Documents' },
  { id: 'comments', label: 'Comments' },
  { id: 'notes', label: 'Notes' },
] as const

type TabId = (typeof TABS)[number]['id']

export function DealCollaboration({
  dealId,
  contactId,
}: {
  dealId: string
  contactId?: string | null
}): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<TabId>('timeline')
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({})

  const { data: docs } = useQuery({
    queryKey: ['dealDocuments', dealId],
    queryFn: () => getDealDocuments(dealId),
  })

  const { data: commentsData } = useQuery({
    queryKey: ['dealComments', dealId],
    queryFn: () => getDealComments(dealId),
  })

  const { data: notesData } = useQuery({
    queryKey: ['notes', { dealId }],
    queryFn: () => getNotes({ dealId }),
  })

  const docCount = docs?.length ?? 0
  const commentCount = commentsData?.total ?? 2
  const notesCount = notesData?.total ?? 0
  const timelineCount = 4

  const getCount = (id: TabId): number => {
    if (id === 'documents') return docCount
    if (id === 'comments') return commentCount
    if (id === 'notes') return notesCount
    return timelineCount
  }

  const handleKeyDown = (event: React.KeyboardEvent, index: number): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const direction = event.key === 'ArrowRight' ? 1 : -1
    const nextIndex = (index + direction + TABS.length) % TABS.length
    const nextTab = TABS[nextIndex]!.id
    setActiveTab(nextTab)
    tabRefs.current[nextTab]?.focus()
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label="Deal collaboration"
        className="flex items-center gap-1 px-3 pt-2.5"
      >
        {TABS.map((tab, index) => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[tab.id] = el
              }}
              type="button"
              role="tab"
              id={`deal-collab-tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`deal-collab-panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={`inline-flex h-8 items-center gap-[7px] rounded-[8px] px-3 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1b1b1f] ${
                isActive
                  ? 'bg-[#f4f4f6] font-semibold text-[#1b1b1f]'
                  : 'font-medium text-[#6b6b76] hover:bg-[#f4f4f6] hover:text-[#1b1b1f]'
              }`}
            >
              {tab.label}
              <span className="text-[11px] text-[#a0a0aa]">{getCount(tab.id)}</span>
            </button>
          )
        })}
      </div>

      <div
        role="tabpanel"
        id="deal-collab-panel-timeline"
        aria-labelledby="deal-collab-tab-timeline"
        hidden={activeTab !== 'timeline'}
      >
        {activeTab === 'timeline' ? <DealTimeline dealId={dealId} contactId={contactId} /> : null}
      </div>

      <div
        role="tabpanel"
        id="deal-collab-panel-documents"
        aria-labelledby="deal-collab-tab-documents"
        hidden={activeTab !== 'documents'}
      >
        {activeTab === 'documents' ? <DealDocuments dealId={dealId} /> : null}
      </div>

      <div
        role="tabpanel"
        id="deal-collab-panel-comments"
        aria-labelledby="deal-collab-tab-comments"
        hidden={activeTab !== 'comments'}
      >
        {activeTab === 'comments' ? <DealComments dealId={dealId} /> : null}
      </div>

      <div
        role="tabpanel"
        id="deal-collab-panel-notes"
        aria-labelledby="deal-collab-tab-notes"
        hidden={activeTab !== 'notes'}
      >
        {activeTab === 'notes' ? <NotesPanel dealId={dealId} /> : null}
      </div>
    </div>
  )
}
