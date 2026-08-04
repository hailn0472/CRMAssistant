'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MessageSquare } from 'lucide-react'

import { cn } from '@/lib/utils'
import { GraphqlSubscriptionClient } from '@/lib/graphql-subscription'
import { ConversationList } from '@/components/inbox/ConversationList'
import { ConversationDetail } from '@/components/inbox/ConversationDetail'
import { InboxSkeleton } from '@/components/inbox/InboxSkeleton'
import { ContactSidebar } from '@/components/inbox/ContactSidebar'
import { StartInternalChat } from '@/components/inbox/StartInternalChat'
import { TaskFormDrawer } from '@/components/tasks/TaskFormDrawer'
import { getConversation } from '@/services/inbox.service'
import { WorkspacePanel } from '@/components/layout/AppShell'

export default function InboxPage(): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showDetail, setShowDetail] = useState(false)
  const [showInternalChat, setShowInternalChat] = useState(false)
  const [newTaskContactId, setNewTaskContactId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [wsClient, setWsClient] = useState<GraphqlSubscriptionClient | null>(null)
  const subClientRef = useRef<GraphqlSubscriptionClient | null>(null)

  const {
    data: selectedConv,
    isLoading: convLoading,
    refetch: refetchConv,
  } = useQuery({
    queryKey: ['conversation', selectedId],
    queryFn: () => getConversation(selectedId!),
    enabled: !!selectedId,
  })

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id)
    setShowDetail(true)
  }, [])

  const handleBack = useCallback(() => {
    setShowDetail(false)
  }, [])

  const handleInternalChatCreated = useCallback((conversationId: string) => {
    setSelectedId(conversationId)
    setShowDetail(true)
  }, [])

  // Connect subscription client — create fresh on mount, full cleanup on unmount.
  // Stored in state (not just the ref) so it can be passed down as a prop and
  // trigger a re-render of ConversationDetail once it's available.
  useEffect(() => {
    const client = new GraphqlSubscriptionClient()
    subClientRef.current = client
    setWsClient(client)
    client.connect().catch(() => {})
    return () => {
      client.disconnect()
      subClientRef.current = null
      setWsClient(null)
    }
  }, [])

  // Conversation-list-level real-time updates (unread counts, last message
  // preview, new conversations appearing). Per-conversation message delivery
  // is handled directly inside ConversationDetail (see `wsClient` prop) so an
  // update to one conversation doesn't force-reload an unrelated open thread.
  useEffect(() => {
    if (!wsClient) return

    const unsubUpdates = wsClient.subscribe('conversations:updates', {
      query: `subscription OnConversationUpdated { onConversationUpdated { id } }`,
      variables: {},
      onData: () => {
        refetchConv()
        setRefreshKey((k) => k + 1)
      },
    })

    return () => {
      unsubUpdates()
    }
  }, [wsClient, refetchConv])

  return (
    <>
      <WorkspacePanel className="flex min-h-[600px] h-[calc(100vh-6.5rem)] overflow-hidden border-[#ececf0] shadow-none">
        {/* List — hidden on mobile when detail is shown */}
        <div
          className={cn(
            'flex min-h-0 w-full flex-col bg-white border-r border-[#ececf0] lg:w-[320px] shrink-0 z-10',
            showDetail && 'hidden lg:flex',
          )}
        >
          <ConversationList
            selectedId={selectedId}
            onSelect={handleSelect}
            className="flex-1"
            refreshKey={refreshKey}
            onStartInternalChat={() => setShowInternalChat(true)}
          />
        </div>

        {/* Detail pane */}
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col bg-[#fafafb] relative overflow-hidden',
            !showDetail && 'hidden lg:flex',
          )}
        >
          {selectedConv ? (
            <ConversationDetail
              conversationId={selectedConv.id}
              contactName={
                selectedConv.contact
                  ? `${selectedConv.contact.firstName} ${selectedConv.contact.lastName}`
                  : selectedConv.title || 'Internal chat'
              }
              status={selectedConv.status}
              channel={selectedConv.channel}
              assignedToUser={selectedConv.assignedToUser}
              className="flex-1"
              onBack={handleBack}
              wsClient={wsClient}
              onConversationUpdated={() => {
                refetchConv()
                setRefreshKey((k) => k + 1)
              }}
            />
          ) : convLoading ? (
            <div className="p-4">
              <InboxSkeleton variant="detail" />
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center text-center p-8">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-[#a0a0aa] mb-6 shadow-sm ring-1 ring-[#ececf0]">
                <MessageSquare className="h-8 w-8" />
              </div>
              <h3 className="text-[17px] font-bold text-[#1b1b1f] tracking-tight">
                Select a conversation
              </h3>
              <p className="mt-1.5 text-[14px] text-[#8c8c96] max-w-xs leading-relaxed">
                Choose an existing conversation from the list or start a new one to begin messaging.
              </p>
            </div>
          )}
        </div>

        {/* Contact Sidebar (3rd Column) */}
        {selectedConv && (
          <div
            className={cn(
              'hidden lg:flex min-h-0 w-[300px] flex-col bg-white border-l border-[#ececf0] shrink-0 overflow-hidden',
            )}
          >
            <ContactSidebar contact={selectedConv.contact} onNewTask={setNewTaskContactId} />
          </div>
        )}
      </WorkspacePanel>

      <StartInternalChat
        open={showInternalChat}
        onOpenChange={setShowInternalChat}
        onConversationCreated={handleInternalChatCreated}
      />

      <TaskFormDrawer
        open={!!newTaskContactId}
        onOpenChange={(open) => {
          if (!open) setNewTaskContactId(null)
        }}
        initialContactId={newTaskContactId ?? undefined}
      />
    </>
  )
}
