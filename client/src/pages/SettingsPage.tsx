import { useState } from 'react';
import { useAccount } from '../context/AccountContext';
import { SyncStatus } from '../components/sync/SyncStatus';
import { ChatSettings } from '../components/chat/ChatSettings';
import { AISettings } from '../components/settings/AISettings';
import { TrackingScriptHelper } from '../components/settings/TrackingScriptHelper';
import { AppearanceSettings } from '../components/settings/AppearanceSettings';
import { GeneralSettings } from '../components/settings/GeneralSettings';
import { EmailSettings } from '../components/settings/EmailSettings';
import { GoldPriceSettings } from '../components/settings/GoldPriceSettings';
import { InventoryAlertsSettings } from '../components/settings/InventoryAlertsSettings';
import { LayoutGrid, Palette, MessageSquare, Bot, Activity, RefreshCw, Mail, Package } from 'lucide-react';

type TabId = 'general' | 'appearance' | 'chat' | 'intelligence' | 'analytics' | 'sync' | 'email' | 'inventory';

export function SettingsPage() {
    const { currentAccount } = useAccount();
    const [activeTab, setActiveTab] = useState<TabId>('general');

    if (!currentAccount) return <div>Loading...</div>;

    const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
        { id: 'general', label: 'General', icon: LayoutGrid },
        { id: 'appearance', label: 'Appearance', icon: Palette },
        { id: 'chat', label: 'Chat', icon: MessageSquare },
        { id: 'intelligence', label: 'Intelligence', icon: Bot },
        { id: 'analytics', label: 'Analytics', icon: Activity },
        { id: 'inventory', label: 'Inventory', icon: Package },

        { id: 'sync', label: 'Sync Status', icon: RefreshCw },
        { id: 'email', label: 'Email', icon: Mail },
    ];

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

            {/* Tabs Navigation */}
            <div className="flex overflow-x-auto border-b border-gray-200 no-scrollbar">
                {tabs.map((tab) => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`
                                flex items-center gap-2 px-6 py-3 border-b-2 font-medium text-sm whitespace-nowrap transition-colors
                                ${isActive
                                    ? 'border-blue-600 text-blue-600'
                                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                }
                            `}
                        >
                            <Icon size={18} />
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {/* Tab Content */}
            <div className="mt-6">
                {activeTab === 'general' && (
                    <div className="space-y-6">
                        <GeneralSettings />
                        <GoldPriceSettings />
                    </div>
                )}

                {activeTab === 'appearance' && (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                        <div className="p-6 border-b border-gray-200">
                            <h2 className="text-lg font-medium text-gray-900">Whitelabeling & Appearance</h2>
                            <p className="text-sm text-gray-500 mt-1">Customize the look and feel of your dashboard.</p>
                        </div>
                        <div className="p-6">
                            <AppearanceSettings />
                        </div>
                    </div>
                )}

                {activeTab === 'chat' && (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                        <div className="p-6 border-b border-gray-200">
                            <h2 className="text-lg font-medium text-gray-900">Live Chat Configuration</h2>
                            <p className="text-sm text-gray-500 mt-1">Manage auto-replies, business hours, and widget behavior.</p>
                        </div>
                        <div className="p-6">
                            <ChatSettings />
                        </div>
                    </div>
                )}

                {activeTab === 'intelligence' && (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200">
                        <div className="p-6 border-b border-gray-200 rounded-t-xl">
                            <h2 className="text-lg font-medium text-gray-900">Intelligence Configuration</h2>
                            <p className="text-sm text-gray-500 mt-1">Manage AI model selection and API keys.</p>
                        </div>
                        <div className="p-6">
                            <AISettings />
                        </div>
                    </div>
                )}

                {activeTab === 'analytics' && (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                        <div className="p-6 border-b border-gray-200">
                            <h2 className="text-lg font-medium text-gray-900">Analytics Configuration</h2>
                            <p className="text-sm text-gray-500 mt-1">Setup the tracking script to enable Live View and Real-time Cart tracking.</p>
                        </div>
                        <div className="p-6">
                            <TrackingScriptHelper />
                        </div>
                    </div>
                )}

                {activeTab === 'inventory' && (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                        <div className="p-6 border-b border-gray-200">
                            <h2 className="text-lg font-medium text-gray-900">Inventory Management</h2>
                            <p className="text-sm text-gray-500 mt-1">Configure stock alerts per account.</p>
                        </div>
                        <div className="p-6">
                            <InventoryAlertsSettings />
                        </div>
                    </div>
                )}

                {activeTab === 'sync' && <SyncStatus />}

                {activeTab === 'email' && <EmailSettings />}
            </div>
        </div>
    );
}

