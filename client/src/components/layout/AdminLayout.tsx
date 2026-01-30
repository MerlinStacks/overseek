import { ReactNode } from 'react';
import { AdminSidebar } from './AdminSidebar';
import { ThemeInjector } from './ThemeInjector';

interface AdminLayoutProps {
    children: ReactNode;
}

export function AdminLayout({ children }: AdminLayoutProps) {
    return (
        <div className="min-h-screen bg-slate-50 flex font-sans text-slate-900">
            {/* Force default blue theme for Admin Panel to differentiate from Whitelabel app */}
            <ThemeInjector />
            <AdminSidebar />
            <div className="flex-1 flex flex-col min-w-0">
                <main className="flex-1 overflow-x-hidden overflow-y-auto bg-slate-100/50">
                    <div className="max-w-[1600px] mx-auto p-8">
                        {children}
                    </div>
                </main>
            </div>
        </div>
    );
}
