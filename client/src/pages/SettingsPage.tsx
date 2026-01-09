import { useState, useEffect } from 'react';
import { useAccount } from '../context/AccountContext';
import { useAccountFeature } from '../hooks/useAccountFeature';
import { SyncStatus } from '../components/sync/SyncStatus';
import { ChatSettings } from '../components/chat/ChatSettings';
import { AISettings } from '../components/settings/AISettings';
import { TrackingScriptHelper } from '../components/settings/TrackingScriptHelper';
import { AppearanceSettings } from '../components/settings/AppearanceSettings';
import { GeneralSettings } from '../components/settings/GeneralSettings';
import { EmailSettings } from '../components/settings/EmailSettings';
import { GoldPriceSettings } from '../components/settings/GoldPriceSettings';
import { InventoryAlertsSettings } from '../components/settings/InventoryAlertsSettings';
import { OrderTagSettings } from '../components/settings/OrderTagSettings';
import { NotificationSettings } from '../components/settings/NotificationSettings';
import { SocialChannelsSettings } from '../components/settings/SocialChannelsSettings';
import { TeamSettings } from '../components/settings/TeamSettings';
import { WebhookSettings } from '../components/settings/WebhookSettings';
import { AdAccountSettings } from '../components/settings/AdAccountSettings';
import {
    LayoutGrid, Palette, MessageSquare, Bot, Activity, RefreshCw,
    Mail, Package, Tags, Coins, Bell, Share2, Users, ChevronRight, Webhook, Megaphone
} from 'lucide-react';

type TabId = 'general' | 'appearance' | 'team' | 'chat' | 'channels' | 'intelligence' | 'analytics' | 'sync' | 'email' | 'inventory' | 'orderTags' | 'goldPrice' | 'notifications' | 'webhooks' | 'ads';

interface TabDef {
    id: TabId;
    label: string;
    icon: React.ElementType;
    hidden?: boolean;
}

interface Category {
    name: string;
    tabs: TabDef[];
}

/**
 * Modern sidebar-based settings layout with grouped categories.
 * Responsive: sidebar on lg+, horizontal tabs on mobile.
 */
export function SettingsPage() {
    const { currentAccount } = useAccount();
    const isGoldPriceEnabled = useAccountFeature('GOLD_PRICE_CALCULATOR');
    const isAdTrackingEnabled = useAccountFeature('AD_TRACKING');
    const [activeTab, setActiveTab] = useState<TabId>('general');

    // Handle URL-based tab selection (for OAuth callbacks)
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const tab = params.get('tab') as TabId | null;
        const validTabs: TabId[] = ['general', 'appearance', 'team', 'chat', 'channels', 'intelligence', 'analytics', 'sync', 'email', 'inventory', 'orderTags', 'goldPrice', 'notifications', 'webhooks', 'ads'];
        if (tab && validTabs.includes(tab)) {
            setActiveTab(tab);
        }
    }, []);

    if (!currentAccount) return <div>Loading...</div>;

    // Grouped categories for sidebar navigation
    const categories: Category[] = [
        {
            name: 'Store',
            tabs: [
                { id: 'general', label: 'General', icon: LayoutGrid },
                { id: 'appearance', label: 'Appearance', icon: Palette },
                { id: 'team', label: 'Team', icon: Users },
            ]
        },
        {
            name: 'Commerce',
            tabs: [
                { id: 'orderTags', label: 'Order Tags', icon: Tags },
                { id: 'inventory', label: 'Inventory', icon: Package },
                { id: 'goldPrice', label: 'Gold Price', icon: Coins, hidden: !isGoldPriceEnabled },
            ]
        },
        {
            name: 'Integrations',
            tabs: [
                { id: 'email', label: 'Email', icon: Mail },
                { id: 'channels', label: 'Channels', icon: Share2 },
                { id: 'ads', label: 'Ad Accounts', icon: Megaphone, hidden: !isAdTrackingEnabled },
                { id: 'webhooks', label: 'Webhooks', icon: Webhook },
                { id: 'sync', label: 'Sync Status', icon: RefreshCw },
            ]
        },
        {
            name: 'Intelligence',
            tabs: [
                { id: 'chat', label: 'Chat Widget', icon: MessageSquare },
                { id: 'intelligence', label: 'AI Models', icon: Bot },
                { id: 'analytics', label: 'Analytics', icon: Activity },
                { id: 'notifications', label: 'Notifications', icon: Bell },
            ]
        }
    ];

    // Flat list for mobile tabs
    const allTabs = categories.flatMap(c => c.tabs).filter(t => !t.hidden);

    const renderContent = () => {
        switch (activeTab) {
            case 'general':
                return <GeneralSettings />;
            case 'orderTags':
                return <OrderTagSettings />;
            case 'goldPrice':
                return <GoldPriceSettings />;
            case 'appearance':
                return (
                    <SettingsCard title="Whitelabeling & Appearance" description="Customize the look and feel of your dashboard.">
                        <AppearanceSettings />
                    </SettingsCard>
                );
            case 'chat':
                return (
                    <SettingsCard title="Live Chat Configuration" description="Manage auto-replies, business hours, and widget behavior.">
                        <ChatSettings />
                    </SettingsCard>
                );
            case 'intelligence':
                return (
                    <SettingsCard title="Intelligence Configuration" description="Manage AI model selection and API keys.">
                        <AISettings />
                    </SettingsCard>
                );
            case 'analytics':
                return (
                    <SettingsCard title="Analytics Configuration" description="Setup the tracking script to enable Live View and Real-time Cart tracking.">
                        <TrackingScriptHelper />
                    </SettingsCard>
                );
            case 'inventory':
                return (
                    <SettingsCard title="Inventory Management" description="Configure stock alerts per account.">
                        <InventoryAlertsSettings />
                    </SettingsCard>
                );
            case 'sync':
                return <SyncStatus />;
            case 'email':
                return <EmailSettings />;
            case 'channels':
                return (
                    <SettingsCard title="Social Channels" description="Connect Facebook, Instagram, and TikTok to receive messages in your inbox.">
                        <SocialChannelsSettings />
                    </SettingsCard>
                );
            case 'notifications':
                return <NotificationSettings />;
            case 'team':
                return <TeamSettings />;
            case 'webhooks':
                return (
                    <SettingsCard title="Webhook Configuration" description="Configure WooCommerce webhooks for instant order sync and notifications.">
                        <WebhookSettings />
                    </SettingsCard>
                );
            case 'ads':
                return (
                    <SettingsCard title="Ad Accounts" description="Connect and manage your Meta and Google Ads accounts.">
                        <AdAccountSettings />
                    </SettingsCard>
                );
            default:
                return null;
        }
    };

    return (
        <div className="min-h-[calc(100vh-6rem)]">
            {/* Page Header */}
            <h1 className="text-xl font-semibold text-gray-900 mb-4">Settings</h1>

            {/* Mobile: Horizontal Tabs */}
            <div className="lg:hidden mb-4">
                <div className="flex overflow-x-auto border-b border-gray-200 no-scrollbar -mx-4 px-4">
                    {allTabs.map((tab) => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`
                                    flex items-center gap-1.5 px-3 py-2 border-b-2 text-xs font-medium whitespace-nowrap transition-colors
                                    ${isActive
                                        ? 'border-blue-600 text-blue-600'
                                        : 'border-transparent text-gray-500 hover:text-gray-700'
                                    }
                                `}
                            >
                                <Icon size={14} />
                                {tab.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Desktop: Sidebar + Content */}
            <div className="hidden lg:flex gap-6">
                {/* Sidebar Navigation */}
                <aside className="w-56 shrink-0">
                    <nav className="glass-panel rounded-xl p-3 sticky top-24 space-y-4">
                        {categories.map((category) => {
                            const visibleTabs = category.tabs.filter(t => !t.hidden);
                            if (visibleTabs.length === 0) return null;
                            return (
                                <div key={category.name}>
                                    <h3 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-2 mb-1">
                                        {category.name}
                                    </h3>
                                    <div className="space-y-0.5">
                                        {visibleTabs.map((tab) => {
                                            const Icon = tab.icon;
                                            const isActive = activeTab === tab.id;
                                            return (
                                                <button
                                                    key={tab.id}
                                                    onClick={() => setActiveTab(tab.id)}
                                                    className={`
                                                        w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-sm transition-all
                                                        ${isActive
                                                            ? 'bg-blue-50/80 text-blue-700 font-medium border-l-2 border-blue-600 -ml-0.5 pl-2.5'
                                                            : 'text-gray-600 hover:bg-gray-100/60 hover:text-gray-900'
                                                        }
                                                    `}
                                                >
                                                    <Icon size={15} className={isActive ? 'text-blue-600' : 'text-gray-400'} />
                                                    {tab.label}
                                                    {isActive && <ChevronRight size={14} className="ml-auto text-blue-400" />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </nav>
                </aside>

                {/* Content Area */}
                <main className="flex-1 min-w-0">
                    {renderContent()}
                </main>
            </div>

            {/* Mobile: Content */}
            <div className="lg:hidden">
                {renderContent()}
            </div>
        </div>
    );
}

/**
 * Wrapper card for settings sections that need consistent styling.
 */
function SettingsCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
    return (
        <div className="bg-white rounded-xl shadow-xs border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="text-base font-medium text-gray-900">{title}</h2>
                <p className="text-xs text-gray-500 mt-0.5">{description}</p>
            </div>
            <div className="p-5">
                {children}
            </div>
        </div>
    );
}

