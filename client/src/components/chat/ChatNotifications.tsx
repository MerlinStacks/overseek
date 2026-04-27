
import { useEffect, useRef } from 'react';
import { useSocket } from '../../context/SocketContext';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useLocation, useNavigate } from 'react-router-dom';

/** Auto-dismiss timeout for notifications (10 minutes) */
const NOTIFICATION_AUTO_DISMISS_MS = 10 * 60 * 1000;
/** Batch non-urgent message notifications into one digest */
const MESSAGE_BATCH_WINDOW_MS = 12_000;

interface NotificationQueueItem {
    conversationId?: string;
    content?: string;
    priority?: string;
}

interface IncomingMessageEvent {
    accountId?: string;
    type?: string;
    senderType?: string;
    assignedTo?: string;
    priority?: string;
    content?: string;
    conversationId?: string;
}

/**
 * Headless component to handle global chat notifications via browser API.
 * Filters notifications to only show for the user's currently active account.
 */
export function ChatNotifications() {
    const { socket } = useSocket();
    const { user } = useAuth();
    const { currentAccount } = useAccount();
    const location = useLocation();
    const navigate = useNavigate();
    const messageQueueRef = useRef<NotificationQueueItem[]>([]);
    const batchTimerRef = useRef<number | null>(null);

    const isWithinQuietHours = () => {
        try {
            const raw = localStorage.getItem('inbox_notification_rules');
            if (!raw) {
                const nowHour = new Date().getHours();
                return nowHour >= 22 || nowHour < 7; // sensible default
            }
            const rules = JSON.parse(raw) as {
                quietHoursEnabled?: boolean;
                quietStartHour?: number;
                quietEndHour?: number;
            };
            if (!rules.quietHoursEnabled) return false;
            const start = Number.isInteger(rules.quietStartHour) ? (rules.quietStartHour as number) : 22;
            const end = Number.isInteger(rules.quietEndHour) ? (rules.quietEndHour as number) : 7;
            const nowHour = new Date().getHours();
            if (start === end) return true;
            if (start < end) return nowHour >= start && nowHour < end;
            return nowHour >= start || nowHour < end;
        } catch {
            return false;
        }
    };

    const showNotification = (title: string, body: string, tag: string, onClick?: () => void) => {
        if (Notification.permission !== 'granted') return;
        const n = new Notification(title, {
            body,
            icon: '/favicon.ico',
            tag
        });
        setTimeout(() => n.close(), NOTIFICATION_AUTO_DISMISS_MS);
        n.onclick = function () {
            window.focus();
            onClick?.();
            n.close();
        };
    };

    // Check permission on mount
    useEffect(() => {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }, []);

    useEffect(() => {
        if (!socket) return;

        const handleNewMessage = (msg: IncomingMessageEvent) => {
            // CRITICAL: Account Isolation - only show notifications for current account
            // Prevents cross-account notification leakage for multi-account users
            if (msg.accountId && currentAccount?.id && msg.accountId !== currentAccount.id) {
                return;
            }

            const isCustomerMessage = msg.type === 'CUSTOMER' || msg.senderType === 'CUSTOMER';
            const isAssignedToMe = !msg.assignedTo || msg.assignedTo === user?.id;
            const isHighPriority = (msg.priority || '').toUpperCase() === 'HIGH';
            const isOnInbox = location.pathname.startsWith('/inbox');
            const isFocusedInbox = isOnInbox && document.visibilityState === 'visible';

            if (isCustomerMessage && isAssignedToMe) {
                // Hygiene rules:
                // - suppress low-priority notifications while actively focused in inbox
                // - suppress low-priority notifications during quiet hours
                if (!isHighPriority && (isFocusedInbox || isWithinQuietHours())) {
                    return;
                }

                if (isHighPriority) {
                    showNotification(
                        'High Priority Message',
                        msg.content || 'Urgent customer message',
                        `conversation-high-${msg.conversationId}`,
                        () => navigate(`/inbox?conversationId=${msg.conversationId}`)
                    );
                    return;
                }

                messageQueueRef.current.push({
                    conversationId: msg.conversationId,
                    content: msg.content,
                    priority: msg.priority
                });

                if (batchTimerRef.current) return;
                batchTimerRef.current = window.setTimeout(() => {
                    const queue = [...messageQueueRef.current];
                    messageQueueRef.current = [];
                    batchTimerRef.current = null;
                    if (queue.length === 0) return;

                    if (queue.length === 1) {
                        const item = queue[0];
                        showNotification(
                            'New Message',
                            item.content || 'You have a new message',
                            `conversation-${item.conversationId}`,
                            () => navigate(`/inbox?conversationId=${item.conversationId}`)
                        );
                        return;
                    }

                    const uniqueConversations = new Set(queue.map(q => q.conversationId).filter(Boolean)).size;
                    showNotification(
                        `${queue.length} New Messages`,
                        `${uniqueConversations} conversations need attention`,
                        'conversation-batch',
                        () => navigate('/inbox')
                    );
                }, MESSAGE_BATCH_WINDOW_MS);
            }
        };

        /**
         * Handle snooze expiry notifications.
         * When a snoozed conversation reopens, notify the assigned agent.
         */
        const handleSnoozeExpired = (data: {
            conversationId: string;
            assignedToId?: string;
            customerName?: string;
            accountId?: string;
        }) => {
            // Account isolation check
            if (data.accountId && currentAccount?.id && data.accountId !== currentAccount.id) {
                return;
            }

            // Only notify if assigned to current user
            if (data.assignedToId && data.assignedToId !== user?.id) {
                return;
            }

            if (Notification.permission === 'granted') {
                const customerName = data.customerName || 'Customer';
                const n = new Notification('Snooze Ended', {
                    body: `Conversation with ${customerName} has reopened`,
                    icon: '/favicon.ico',
                    tag: `snooze-${data.conversationId}`,
                });

                // Auto-dismiss after 10 minutes
                setTimeout(() => n.close(), NOTIFICATION_AUTO_DISMISS_MS);

                n.onclick = function () {
                    window.focus();
                    navigate(`/inbox?conversationId=${data.conversationId}`);
                    n.close();
                };
            }
        };

        socket.on('message:new', handleNewMessage);
        socket.on('snooze:expired', handleSnoozeExpired);

        return () => {
            if (batchTimerRef.current) {
                window.clearTimeout(batchTimerRef.current);
                batchTimerRef.current = null;
            }
            socket.off('message:new', handleNewMessage);
            socket.off('snooze:expired', handleSnoozeExpired);
        };
    }, [socket, location.pathname, user, navigate, currentAccount?.id]);

    return null; // Headless
}

