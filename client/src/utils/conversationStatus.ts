/**
 * Conversation Status Utilities
 * 
 * Centralized status configuration for chat conversations.
 */

/**
 * Conversation status types
 */
export type ConversationStatus = 'OPEN' | 'CLOSED' | 'SNOOZED';

/**
 * Conversation priority types
 */
export type ConversationPriority = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * Status configuration for conversations
 */
export const CONVERSATION_STATUS_CONFIG: Record<ConversationStatus, {
    label: string;
    color: string;
    bgColor: string;
    textColor: string;
}> = {
    OPEN: {
        label: 'Open',
        color: 'green',
        bgColor: 'bg-green-100',
        textColor: 'text-green-700',
    },
    CLOSED: {
        label: 'Closed',
        color: 'gray',
        bgColor: 'bg-gray-100',
        textColor: 'text-gray-700',
    },
    SNOOZED: {
        label: 'Snoozed',
        color: 'yellow',
        bgColor: 'bg-yellow-100',
        textColor: 'text-yellow-700',
    },
};

/**
 * Priority configuration for conversations
 */
export const CONVERSATION_PRIORITY_CONFIG: Record<ConversationPriority, {
    label: string;
    color: string;
    textColor: string;
}> = {
    HIGH: {
        label: 'High',
        color: 'red',
        textColor: 'text-red-600',
    },
    MEDIUM: {
        label: 'Medium',
        color: 'yellow',
        textColor: 'text-yellow-600',
    },
    LOW: {
        label: 'Low',
        color: 'green',
        textColor: 'text-green-600',
    },
};

/**
 * Get the CSS classes for a conversation status badge.
 */
export function getConversationStatusColor(status: string): string {
    const config = CONVERSATION_STATUS_CONFIG[status as ConversationStatus];
    return config ? `${config.bgColor} ${config.textColor}` : 'bg-gray-100 text-gray-700';
}

/**
 * Get the text color class for a conversation priority.
 */
export function getConversationPriorityColor(priority?: string): string {
    if (!priority) return 'text-gray-500';
    const config = CONVERSATION_PRIORITY_CONFIG[priority as ConversationPriority];
    return config?.textColor || 'text-gray-500';
}

/**
 * Get the label for a conversation status.
 */
export function getConversationStatusLabel(status: string): string {
    const config = CONVERSATION_STATUS_CONFIG[status as ConversationStatus];
    return config?.label || status;
}

/**
 * Get the label for a conversation priority.
 */
export function getConversationPriorityLabel(priority: string): string {
    const config = CONVERSATION_PRIORITY_CONFIG[priority as ConversationPriority];
    return config?.label || priority;
}
