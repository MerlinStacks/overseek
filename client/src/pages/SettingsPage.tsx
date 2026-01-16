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
import RoleManager from '../components/settings/RoleManager';
import { WebhookSettings } from '../components/settings/WebhookSettings';
import { AdAccountSettings } from '../components/settings/AdAccountSettings';
import { CannedResponsesSettings } from '../components/settings/CannedResponsesSettings';
import {
    LayoutGrid, Palette, MessageSquare, Bot, Activity, RefreshCw,
    Mail, Package, Tags, Coins, Bell, Share2, Users, ChevronRight, Webhook, Megaphone, Zap, Shield
} from 'lucide-react';

type TabId = 'general' | 'appearance' | 'team' | 'roles' | 'chat' | 'channels' | 'intelligence' | 'analytics' | 'sync' | 'email' | 'inventory' | 'orderTags' | 'goldPrice' | 'notifications' | 'webhooks' | 'ads' | 'cannedResponses';

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
    const isAIEnabled = useAccountFeature('AI_WRITER');
    const [activeTab, setActiveTab] = useState<TabId>('general');

    // Handle URL-based tab selection (for OAuth callbacks)
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const tab = params.get('tab') as TabId | null;
        const validTabs: TabId[] = ['general', 'appearance', 'team', 'roles', 'chat', 'channels', 'intelligence', 'analytics', 'sync', 'email', 'inventory', 'orderTags', 'goldPrice', 'notifications', 'webhooks', 'ads', 'cannedResponses'];
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
                { id: 'roles', label: 'Roles', icon: Shield },
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
                { id: 'cannedResponses', label: 'Canned Responses', icon: Zap },
                { id: 'intelligence', label: 'AI Models', icon: Bot, hidden: !isAIEnabled },
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
            case 'cannedResponses':
                return (
                    <SettingsCard title="Canned Responses" description="Create reusable message templates with placeholders.">
                        <CannedResponsesSettings />
                    </SettingsCard>
                );
            case 'team':
                return <TeamSettings />;
            case 'roles':
                return (
                    <SettingsCard title="Roles & Permissions" description="Create custom roles with granular permissions for STAFF members.">
                        <RoleManager />
                    </SettingsCard>
                );
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
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">Settings</h1>

            {/* Mobile: Horizontal Tabs */}
            <div className="lg:hidden mb-6">
                <div className="flex overflow-x-auto border-b border-slate-200 dark:border-slate-700 no-scrollbar -mx-4 px-4">
                    {allTabs.map((tab) => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`
                                    flex items-center gap-2 px-4 py-3 border-b-2 text-sm font-medium whitespace-nowrap transition-colors
                                    ${isActive
                                        ? 'border-blue-600 dark:border-blue-400 text-blue-600 dark:text-blue-400'
                                        : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                                    }
                                `}
                            >
                                <Icon size={16} />
                                {tab.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Desktop: Sidebar + Content */}
            <div className="hidden lg:flex gap-8">
                {/* Sidebar Navigation */}
                <aside className="w-64 shrink-0 px-1">
                    <nav className="sticky top-24 space-y-6">
                        {categories.map((category) => {
                            const visibleTabs = category.tabs.filter(t => !t.hidden);
                            if (visibleTabs.length === 0) return null;
                            return (
                                <div key={category.name}>
                                    <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider px-3 mb-2">
                                        {category.name}
                                    </h3>
                                    <div className="space-y-1">
                                        {visibleTabs.map((tab) => {
                                            const Icon = tab.icon;
                                            const isActive = activeTab === tab.id;
                                            return (
                                                <button
                                                    key={tab.id}
                                                    onClick={() => setActiveTab(tab.id)}
                                                    className={`
                                                        w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm transition-all duration-200 group
                                                        ${isActive
                                                            ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 font-semibold shadow-sm shadow-blue-500/5'
                                                            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200'
                                                        }
                                                    `}
                                                >
                                                    <Icon size={18} className={`transition-colors ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300'}`} />
                                                    {tab.label}
                                                    {isActive && <ChevronRight size={14} className="ml-auto text-blue-400 dark:text-blue-500" />}
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
                    <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                        {renderContent()}
                    </div>
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
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden text-slate-900 dark:text-slate-100 transition-all duration-300">
            <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-700/50 bg-slate-50/50 dark:bg-slate-800/50 backdrop-blur-sm">
                <h2 className="text-lg font-semibold text-slate-800 dark:text-white">{title}</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{description}</p>
            </div>
            <div className="p-6">
                {children}
            </div>
        </div>
    );
}

