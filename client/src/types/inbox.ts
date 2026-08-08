import type { ConversationChannel } from '../components/chat/ChannelSelector';

export interface InboxMessage {
    id: string;
    content: string;
    senderType: 'AGENT' | 'CUSTOMER' | 'SYSTEM';
    createdAt: string;
    isInternal: boolean;
    conversationId?: string;
    clientRequestId?: string;
    deliveryStatus?: 'PENDING' | 'SENT' | 'FAILED';
    deliveryError?: string | null;
    deliveryChannel?: string | null;
    [key: string]: unknown;
}

export interface MessageSendResponse {
    message?: InboxMessage;
    error?: string;
}

export type SendMessageHandler = (
    content: string,
    type: 'AGENT' | 'SYSTEM',
    isInternal: boolean,
    channel?: ConversationChannel,
    emailAccountId?: string,
    clientRequestId?: string,
    persistedMessage?: InboxMessage,
) => Promise<void>;

interface InboxWooCustomer {
    id?: string;
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
    unavailableReason?: string;
}
