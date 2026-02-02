/**
 * InboxSkeleton
 * 
 * Skeleton loading state for the Inbox page.
 * Displays realistic placeholders for conversation list and chat area.
 */

import { Skeleton, SkeletonAvatar, SkeletonText } from '../ui/Skeleton';

/**
 * Conversation list item skeleton - mimics conversation preview cards
 */
function ConversationItemSkeleton() {
    return (
        <div className="flex items-start gap-3 p-4 border-b border-gray-100">
            <SkeletonAvatar size="lg" />
            <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-3 w-12" />
                </div>
                <Skeleton className="h-3 w-full mb-1" />
                <Skeleton className="h-3 w-2/3" />
            </div>
        </div>
    );
}

/**
 * Sidebar skeleton - shows multiple conversation placeholders
 */
function SidebarSkeleton() {
    return (
        <div className="w-80 border-r border-gray-200 bg-white flex flex-col">
            {/* Header */}
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                <Skeleton className="h-6 w-24" />
                <div className="flex gap-2">
                    <Skeleton className="h-8 w-8" rounded="lg" />
                    <Skeleton className="h-8 w-8" rounded="lg" />
                </div>
            </div>

            {/* Search */}
            <div className="p-3 border-b border-gray-100">
                <Skeleton className="h-10 w-full" rounded="lg" />
            </div>

            {/* Filter tabs */}
            <div className="flex gap-2 p-3 border-b border-gray-100">
                <Skeleton className="h-7 w-16" rounded="full" />
                <Skeleton className="h-7 w-20" rounded="full" />
                <Skeleton className="h-7 w-16" rounded="full" />
            </div>

            {/* Conversation items */}
            <div className="flex-1 overflow-hidden">
                {Array.from({ length: 8 }).map((_, i) => (
                    <ConversationItemSkeleton key={i} />
                ))}
            </div>
        </div>
    );
}

/**
 * Chat area skeleton - shows message area placeholder
 */
function ChatAreaSkeleton() {
    return (
        <div className="flex-1 flex flex-col bg-white">
            {/* Header */}
            <div className="h-16 border-b border-gray-200 px-4 flex items-center gap-3">
                <SkeletonAvatar size="md" />
                <div className="flex-1">
                    <Skeleton className="h-5 w-36 mb-1" />
                    <Skeleton className="h-3 w-24" />
                </div>
                <div className="flex gap-2">
                    <Skeleton className="h-8 w-8" rounded="lg" />
                    <Skeleton className="h-8 w-8" rounded="lg" />
                    <Skeleton className="h-8 w-8" rounded="lg" />
                </div>
            </div>

            {/* Messages area */}
            <div className="flex-1 p-4 space-y-4 overflow-hidden">
                {/* Incoming message */}
                <div className="flex gap-3 max-w-[70%]">
                    <SkeletonAvatar size="sm" />
                    <div className="flex-1">
                        <Skeleton className="h-20 w-64" rounded="lg" />
                    </div>
                </div>

                {/* Outgoing message */}
                <div className="flex gap-3 max-w-[70%] ml-auto">
                    <div className="flex-1">
                        <Skeleton className="h-16 w-56 ml-auto" rounded="lg" />
                    </div>
                </div>

                {/* Another incoming */}
                <div className="flex gap-3 max-w-[70%]">
                    <SkeletonAvatar size="sm" />
                    <div className="flex-1">
                        <Skeleton className="h-12 w-48" rounded="lg" />
                    </div>
                </div>
            </div>

            {/* Composer */}
            <div className="border-t border-gray-200 p-4">
                <Skeleton className="h-24 w-full" rounded="lg" />
            </div>
        </div>
    );
}

/**
 * Contact panel skeleton - shows right sidebar placeholder
 */
function ContactPanelSkeleton() {
    return (
        <div className="w-80 border-l border-gray-200 bg-white hidden lg:flex flex-col">
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-6 w-6" rounded="sm" />
            </div>

            {/* Contact card */}
            <div className="p-4 border-b border-gray-100">
                <div className="flex items-center gap-3 mb-4">
                    <SkeletonAvatar size="lg" />
                    <div className="flex-1">
                        <Skeleton className="h-5 w-32 mb-1" />
                        <Skeleton className="h-3 w-40" />
                    </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-2">
                    <Skeleton className="h-16" rounded="lg" />
                    <Skeleton className="h-16" rounded="lg" />
                    <Skeleton className="h-16" rounded="lg" />
                </div>
            </div>

            {/* Sections */}
            <div className="flex-1 p-4 space-y-4">
                <Skeleton className="h-4 w-24" />
                <SkeletonText lines={3} />

                <Skeleton className="h-4 w-28 mt-6" />
                <SkeletonText lines={4} />
            </div>
        </div>
    );
}

/**
 * Complete Inbox skeleton for initial page load
 */
export function InboxSkeleton() {
    return (
        <div className="-m-4 md:-m-6 lg:-m-8 h-[calc(100vh-64px)] flex bg-gray-100 overflow-hidden">
            <SidebarSkeleton />
            <ChatAreaSkeleton />
            <ContactPanelSkeleton />
        </div>
    );
}

/**
 * Skeleton for just the chat area (when switching conversations)
 */
export function ChatWindowSkeleton() {
    return <ChatAreaSkeleton />;
}

/**
 * Export individual pieces for granular use
 */
export { ContactPanelSkeleton };
