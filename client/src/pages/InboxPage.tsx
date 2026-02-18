
import { lazy, Suspense } from 'react';
import { useInbox } from './useInbox';
import { ConversationList } from '../components/chat/ConversationList';
import { ChatWindow } from '../components/chat/ChatWindow';
import { InboxSkeleton, ContactPanelSkeleton } from '../components/chat/InboxSkeleton';
import { NewEmailModal } from '../components/chat/NewEmailModal';
import { KeyboardShortcutsHelp } from '../components/chat/KeyboardShortcutsHelp';
import { MessageSquare } from 'lucide-react';

// Lazy load ContactPanel - only needed when a conversation is selected
const ContactPanel = lazy(() => import('../components/chat/ContactPanel').then(m => ({ default: m.ContactPanel })));

/**
 * InboxPage — presentational shell.
 *
 * All state management, data-fetching, socket listeners, and mutations
 * live in the `useInbox` hook. This component only renders UI.
 */
export function InboxPage() {
    const {
        conversations,
        selectedId,
        setSelectedId,
        messages,
        isLoading,
        isComposeOpen,
        setIsComposeOpen,
        isShortcutsHelpOpen,
        setIsShortcutsHelpOpen,
        availableChannels,
        hasMore,
        isLoadingMore,
        activeConversation,
        recipientEmail,
        recipientName,
        customerData,
        user,
        fetchConversations,
        loadMoreConversations,
        handlePreloadConversation,
        handleSendMessage,
        handleStatusChange,
        handleAssign,
        handleMerge,
        handleBlock,
        canned,
        emailAccounts,
    } = useInbox();

    if (isLoading) {
        return <InboxSkeleton />;
    }

    return (
        <div className="-m-4 md:-m-6 lg:-m-8 h-[calc(100vh-64px)] flex bg-gray-100 overflow-hidden">
            {/* Conversations List */}
            <ConversationList
                conversations={conversations}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onPreload={handlePreloadConversation}
                currentUserId={user?.id}
                onCompose={() => setIsComposeOpen(true)}
                hasMore={hasMore}
                isLoadingMore={isLoadingMore}
                onLoadMore={loadMoreConversations}
            />

            {/* Main Chat Area */}
            <div className="flex-1 flex flex-col min-w-0 bg-white">
                {selectedId ? (
                    <ChatWindow
                        conversationId={selectedId}
                        messages={messages}
                        onSendMessage={handleSendMessage}
                        recipientEmail={recipientEmail}
                        recipientName={recipientName}
                        status={activeConversation?.status}
                        assigneeId={activeConversation?.assignedTo}
                        availableChannels={availableChannels}
                        currentChannel={activeConversation?.channel || 'CHAT'}
                        mergedRecipients={activeConversation?.mergedFrom || []}
                        customerData={customerData}
                        onStatusChange={handleStatusChange}
                        onAssign={handleAssign}
                        onMerge={handleMerge}
                        onBlock={handleBlock}
                        // Canned responses (lifted hook)
                        cannedResponses={canned.cannedResponses}
                        filteredCanned={canned.filteredCanned}
                        showCanned={canned.showCanned}
                        setShowCanned={canned.setShowCanned}
                        showCannedManager={canned.showCannedManager}
                        setShowCannedManager={canned.setShowCannedManager}
                        handleInputForCanned={canned.handleInputForCanned}
                        selectCanned={canned.selectCanned}
                        refetchCanned={canned.refetchCanned}
                        // Email accounts (lifted hook)
                        emailAccounts={emailAccounts.emailAccounts}
                        selectedEmailAccountId={emailAccounts.selectedEmailAccountId}
                        onEmailAccountChange={emailAccounts.setSelectedEmailAccountId}
                    />
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                        <MessageSquare size={48} strokeWidth={1} className="mb-4" />
                        <p className="text-lg font-medium">Select a conversation</p>
                        <p className="text-sm">Choose from the list on the left</p>
                    </div>
                )}
            </div>

            {/* Contact Panel - Right Sidebar (Lazy Loaded) */}
            {selectedId && (
                <Suspense fallback={<ContactPanelSkeleton />}>
                    <ContactPanel
                        conversation={activeConversation}
                        onSelectConversation={(id) => setSelectedId(id)}
                    />
                </Suspense>
            )}

            {/* Compose New Email Modal */}
            {isComposeOpen && (
                <NewEmailModal
                    onClose={() => setIsComposeOpen(false)}
                    onSent={async (conversationId) => {
                        setIsComposeOpen(false);
                        setSelectedId(conversationId);
                        await fetchConversations();
                    }}
                />
            )}

            {/* Keyboard Shortcuts Help Modal */}
            <KeyboardShortcutsHelp
                isOpen={isShortcutsHelpOpen}
                onClose={() => setIsShortcutsHelpOpen(false)}
            />
        </div>
    );
}
