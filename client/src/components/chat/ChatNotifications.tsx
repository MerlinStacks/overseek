
import { useEffect } from 'react';
import { useSocket } from '../../context/SocketContext';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useLocation, useNavigate } from 'react-router-dom';

/** Auto-dismiss timeout for notifications (10 minutes) */
const NOTIFICATION_AUTO_DISMISS_MS = 10 * 60 * 1000;

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

    // Check permission on mount
    useEffect(() => {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }, []);

    useEffect(() => {
        if (!socket) return;

        const handleNewMessage = (msg: any) => {
            // CRITICAL: Account Isolation - only show notifications for current account
            // Prevents cross-account notification leakage for multi-account users
            if (msg.accountId && currentAccount?.id && msg.accountId !== currentAccount.id) {
                return;
            }

            const isCustomerMessage = msg.type === 'CUSTOMER' || msg.senderType === 'CUSTOMER';
            const isAssignedToMe = !msg.assignedTo || msg.assignedTo === user?.id;

            if (isCustomerMessage && isAssignedToMe) {
                // If we are currently ON the inbox page AND looking at this specific conversation, maybe don't notify?
                // Or simply always notify if window is blurred? 
                // Let's rely on standard browser behavior (sometimes they mute notification if focused).
                // But generally users like a 'ding' even if open.

                // However, if we are active on that specific chat, it might be annoying.
                // InboxPage route is usually /inbox. 
                const isOnInbox = location.pathname.startsWith('/inbox');
                // We don't easily know the "active" conversation ID here without accessing InboxPage state.
                // But generally, a notification is safe.

                if (Notification.permission === 'granted') {
                    const n = new Notification('New Message', {
                        body: msg.content || 'You have a new message',
                        icon: '/favicon.ico',
                        tag: `conversation-${msg.conversationId}`
                    });

                    // Auto-dismiss after 10 minutes
                    setTimeout(() => n.close(), NOTIFICATION_AUTO_DISMISS_MS);

                    n.onclick = function () {
                        window.focus();
                        n.close();
                    };
                }
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
                const n = new Notification('⏰ Snooze Ended', {
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
            socket.off('message:new', handleNewMessage);
            socket.off('snooze:expired', handleSnoozeExpired);
        };
    }, [socket, location.pathname, user, navigate, currentAccount?.id]);

    return null; // Headless
}
