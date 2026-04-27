import type { ConversationChannel } from '../components/chat/ChannelSelector';

export interface InboxMessage {
    id: string;
    content: string;
    senderType: 'AGENT' | 'CUSTOMER' | 'SYSTEM';
    createdAt: string;
    isInternal: boolean;
    conversationId?: string;
    [key: string]: unknown;
}

export interface InboxWooCustomer {
    firstName?: string;
    lastName?: string;
    email?: string;
    ordersCount?: number;
    totalSpent?: number;
    wooId?: number;
}

export interface InboxConversation {
    id: string;
    status: string;
    updatedAt: string;
    messages: InboxMessage[];
    assignedTo?: string | null;
    isRead?: boolean;
    guestEmail?: string;
    guestName?: string;
    wooCustomer?: InboxWooCustomer;
    channel?: ConversationChannel;
    mergedFrom?: Array<{ id?: string; name?: string; email?: string }>;
    [key: string]: unknown;
}

export interface AvailableChannelOption {
    channel: ConversationChannel;
    identifier: string;
    available: boolean;
}
