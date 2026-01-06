import { ReactNode, useState } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { AIChatWidget } from '../ai/AIChatWidget';
import { ChatNotifications } from '../chat/ChatNotifications';
import { OrderNotifications } from '../notifications/OrderNotifications';
import { CommandPalette } from '../ui/CommandPalette';
import { ThemeInjector } from './ThemeInjector';
import { useMobile } from '../../hooks/useMobile';

interface DashboardLayoutProps {
    children: ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
    const isMobile = useMobile();
    const [sidebarOpen, setSidebarOpen] = useState(false);

    return (
        <div className="min-h-screen bg-gray-50 flex font-sans text-gray-900">
            <ThemeInjector />
            <CommandPalette />
            <ChatNotifications />
            <OrderNotifications />

            {/* Desktop Sidebar - CSS hides on mobile via hidden lg:flex */}
            <Sidebar />

            {/* Mobile Sidebar Drawer - only renders on mobile */}
            {isMobile && (
                <Sidebar
                    isMobile
                    isOpen={sidebarOpen}
                    onClose={() => setSidebarOpen(false)}
                />
            )}

            <div className="flex-1 flex flex-col min-w-0">
                <Header
                    onMenuClick={() => setSidebarOpen(true)}
                    showMenuButton={isMobile}
                />

                <main className="flex-1 overflow-x-hidden bg-gray-50 relative">
                    <AIChatWidget />
                    <div className="max-w-[1600px] mx-auto p-4 md:p-6 lg:p-8">
                        {children}
                    </div>
                </main>
            </div>
        </div>
    );
}
