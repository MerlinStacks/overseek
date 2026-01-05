import { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { AIChatWidget } from '../ai/AIChatWidget';
import { ChatNotifications } from '../chat/ChatNotifications';
import { CommandPalette } from '../ui/CommandPalette';

interface DashboardLayoutProps {
    children: ReactNode;
}

import { ThemeInjector } from './ThemeInjector';

export function DashboardLayout({ children }: DashboardLayoutProps) {
    return (
        <div className="min-h-screen bg-gray-50 flex font-sans text-gray-900">
            <ThemeInjector />
            <CommandPalette />
            <ChatNotifications />
            <Sidebar />
            <div className="flex-1 flex flex-col min-w-0">
                <Header />

                <main className="flex-1 overflow-x-hidden bg-gray-50 relative">
                    <AIChatWidget />
                    <div className="max-w-[1600px] mx-auto p-8">
                        {children}
                    </div>
                </main>
            </div>
        </div>
    );
}
