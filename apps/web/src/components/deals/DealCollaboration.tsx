'use client'

import { useRef, useState } from 'react'

import { DealDocuments } from './DealDocuments'
import { DealComments } from './DealComments'

/**
 * Two-tab Collaboration block (Documents | Comments) for the deal detail page
 * (AC 37/38). The switcher is hand-rolled — `@radix-ui/react-tabs` and
 * `components/ui/tabs.tsx` do not exist, and two tabs do not justify a
 * dependency. ARIA: `tablist`/`tab`/`tabpanel`, `aria-selected`,
 * `aria-controls`/`aria-labelledby`, Left/Right arrow key navigation, and only
 * the active trigger in the tab order (tabIndex 0 / -1).
 */
const TABS = [
  { id: 'documents', label: 'Documents' },
  { id: 'comments', label: 'Comments' },
] as const

type TabId = (typeof TABS)[number]['id']

export function DealCollaboration({ dealId }: { dealId: string }): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<TabId>('documents')
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({})

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
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Deal collaboration"
        className="flex gap-1 border-b border-slate-200"
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
              className={`-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                isActive
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
              }`}
            >
              {tab.label}
            </button>
          )
        })}
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
    </div>
  )
}
