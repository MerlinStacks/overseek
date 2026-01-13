import { useEffect } from 'react';
import { useSocket } from '../../context/SocketContext';
import { Logger } from '../../utils/logger';

/**
 * Headless component to handle browser notifications for new orders.
 * Requests notification permission on mount and listens for order:new socket events.
 */
export function OrderNotifications() {
    const { socket } = useSocket();

    // Request notification permission on mount
    useEffect(() => {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }, []);

    useEffect(() => {
        if (!socket) return;

        const handleNewOrder = (order: {
            orderId: number;
            orderNumber: string | number;
            total: string;
            customerName: string;
        }) => {
            Logger.debug('[OrderNotifications] Received order:new event', { order });
            // Show browser notification if permission granted
            if (Notification.permission === 'granted') {
                const notification = new Notification('🛒 New Order Received!', {
                    body: `Order #${order.orderNumber} - $${order.total} from ${order.customerName}`,
                    icon: '/favicon.ico',
                    tag: `order-${order.orderId}`, // Prevent duplicate notifications for same order
                    requireInteraction: true // Keep notification visible until user interacts
                });

                notification.onclick = () => {
                    window.focus();
                    // Navigate to orders page
                    window.location.href = '/orders';
                };
            }
        };

        socket.on('order:new', handleNewOrder);

        return () => {
            socket.off('order:new', handleNewOrder);
        };
    }, [socket]);

    return null; // Headless component
}
