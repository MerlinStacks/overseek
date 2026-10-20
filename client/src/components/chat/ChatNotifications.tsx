import { useEffect } from 'react';
import { useSocket } from '../../context/SocketContext';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useLocation, useNavigate } from 'react-router-dom';

interface MessageEvent {
    accountId?: string; conversationId?: string; content?: string;
    type?: string; senderType?: string; assignedTo?: string; priority?: string;
}

function quietHours(): boolean {
    const hour = new Date().getHours();
    const fallback = hour >= 22 || hour < 7;
    try {
        const raw = localStorage.getItem('inbox_notification_rules');
        if (!raw) return fallback;
        const rules = JSON.parse(raw);
        if (!rules || typeof rules !== 'object') return fallback;
        if (rules.quietHoursEnabled === false) return false;
        if (rules.quietHoursEnabled !== true) return fallback;
        const validHour = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 23;
        const start = validHour(rules.quietStartHour) ? rules.quietStartHour : 22;
        const end = validHour(rules.quietEndHour) ? rules.quietEndHour : 7;
        return start === end || (start < end ? hour >= start && hour < end : hour >= start || hour < end);
    } catch { return fallback; }
}

/** Notifications are owned by one account/user scope, including their queued work. */
export function ChatNotifications() {
    const { socket } = useSocket();
    const { user } = useAuth();
    const { currentAccount } = useAccount();
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const accountId = currentAccount?.id;
    const userId = user?.id;

    useEffect(() => {
        if (!socket || !accountId || !userId || typeof window.Notification !== 'function') return;
        let active = true;
        let queue: MessageEvent[] = [];
        let batchTimer: ReturnType<typeof setTimeout> | null = null;
        const notifications = new Map<Notification, ReturnType<typeof setTimeout>>();
        const show = (title: string, body: string, tag: string, conversationId?: string) => {
            if (!active || Notification.permission !== 'granted') return;
            try {
                const notification = new Notification(title, { body, icon: '/favicon.ico', tag: `${accountId}:${tag}` });
                const dispose = () => {
                    const timer = notifications.get(notification);
                    if (timer) clearTimeout(timer);
                    notifications.delete(notification); notification.onclick = null; notification.onclose = null;
                    notification.close();
                };
                notifications.set(notification, setTimeout(dispose, 10 * 60 * 1000));
                notification.onclose = () => { const timer = notifications.get(notification); if (timer) clearTimeout(timer); notifications.delete(notification); };
                notification.onclick = () => {
                    if (active) { window.focus(); navigate(conversationId ? `/inbox?conversationId=${encodeURIComponent(conversationId)}` : '/inbox'); }
                    dispose();
                };
            } catch { /* Some mobile browsers expose Notification but disallow its constructor. */ }
        };
        const focusedInbox = () => pathname.startsWith('/inbox') && document.visibilityState === 'visible' && document.hasFocus();
        const handleMessage = (message: MessageEvent) => {
            if (!active || !message || message.accountId !== accountId || typeof message.conversationId !== 'string' || !message.conversationId) return;
            if (!(message.type === 'CUSTOMER' || message.senderType === 'CUSTOMER') || (message.assignedTo && message.assignedTo !== userId)) return;
            const high = typeof message.priority === 'string' && message.priority.toUpperCase() === 'HIGH';
            const content = typeof message.content === 'string' ? message.content : 'You have a new message';
            if (high) { show('High Priority Message', content, `high:${message.conversationId}`, message.conversationId); return; }
            if (focusedInbox() || quietHours()) return;
            // Bound retained content during bursts; a digest does not need every message body.
            if (queue.length < 1000) queue.push({ conversationId: message.conversationId, content });
            if (batchTimer) return;
            batchTimer = setTimeout(() => {
                batchTimer = null;
                const batch = queue; queue = [];
                if (!active || batch.length === 0 || focusedInbox() || quietHours()) return;
                if (batch.length === 1) show('New Message', batch[0].content || 'You have a new message', `message:${batch[0].conversationId}`, batch[0].conversationId);
                else show(`${batch.length} New Messages`, `${new Set(batch.map(item => item.conversationId)).size} conversations need attention`, 'batch');
            }, 12000);
        };
        const handleSnooze = (data: { accountId?: string; conversationId?: string; assignedToId?: string; customerName?: string }) => {
            if (!active || !data || data.accountId !== accountId || typeof data.conversationId !== 'string' || !data.conversationId || (data.assignedToId && data.assignedToId !== userId)) return;
            show('Snooze Ended', `Conversation with ${typeof data.customerName === 'string' ? data.customerName : 'Customer'} has reopened`, `snooze:${data.conversationId}`, data.conversationId);
        };
        socket.on('message:new', handleMessage); socket.on('snooze:expired', handleSnooze);
        return () => {
            active = false; queue = []; if (batchTimer) clearTimeout(batchTimer);
            socket.off('message:new', handleMessage); socket.off('snooze:expired', handleSnooze);
            for (const [notification, timer] of notifications) { clearTimeout(timer); notification.onclick = null; notification.onclose = null; try { notification.close(); } catch { /* Already disposed by the browser. */ } }
            notifications.clear();
        };
    }, [socket, accountId, userId, navigate, pathname]);
    return null;
}
