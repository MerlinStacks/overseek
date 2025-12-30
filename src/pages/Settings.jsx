import React, { useState } from 'react';
import { useSettings } from '../context/SettingsContext';
import { Mail, Server, RefreshCw, Cpu, Database, LayoutGrid, Palette, Activity, MessageCircle } from 'lucide-react';
import { Toaster } from 'sonner';
import './Settings.css';

// Sub Components
import GeneralSettings from '../components/settings/GeneralSettings';
import SyncSettings from '../components/settings/SyncSettings';
import SMTPSettings from '../components/settings/SMTPSettings';
import AISettings from '../components/settings/AISettings';
import SystemStatus from '../components/settings/SystemStatus';

import BackupSettings from '../components/settings/BackupSettings';
import AppearanceSettings from '../components/settings/AppearanceSettings';
import AutoTagSettings from '../components/settings/AutoTagSettings';
import MarketingSettings from '../components/settings/MarketingSettings';
import ChatSettings from '../components/settings/ChatSettings';
import { useAccount } from '../context/AccountContext';

const Settings = () => {
    const { settings, updateSettings } = useSettings();
    const { activeAccount } = useAccount();
    const [activeTab, setActiveTab] = useState('general');

    const menuItems = [
        { id: 'general', label: 'General', icon: Server, desc: 'Store connection & keys' },
        { id: 'status', label: 'System Status', icon: Activity, desc: 'Health Checks & Diagnostics' },
        { id: 'sync', label: 'Synchronization', icon: RefreshCw, desc: 'Data pull settings' },
        { id: 'appearance', label: 'Appearance', icon: Palette, desc: 'Colors & branding' },
        { id: 'email', label: 'Email Services', icon: Mail, desc: 'SMTP configuration' },
        { id: 'ai', label: 'Intelligence', icon: Cpu, desc: 'AI assistant models' },
        { id: 'chat', label: 'Live Chat', icon: MessageCircle, desc: 'Widget & Business Hours' },
        { id: 'backup', label: 'Backup & Restore', icon: Database, desc: 'Export/Import dashboard data' },
    ];

    // Feature Flag: Marketing
    if (activeAccount?.features?.adRevenueTracking) {
        menuItems.splice(3, 0, { id: 'marketing', label: 'Marketing', icon: LayoutGrid, desc: 'Ad platforms & Pixel' });
    }

    return (
        <div className="settings-page">
            <Toaster position="top-right" theme="dark" />
            <div className="glass-panel settings-container">

                {/* Sidebar Navigation */}
                <div className="settings-sidebar">
                    <h2 className="settings-sidebar-title">
                        <LayoutGrid size={20} /> Settings
                    </h2>
                    <div className="settings-nav-list">
                        {menuItems.map(item => (
                            <button
                                key={item.id}
                                onClick={() => setActiveTab(item.id)}
                                className={`settings-nav-item ${activeTab === item.id ? 'active' : ''}`}
                            >
                                <item.icon size={18} />
                                <div>
                                    <div className="nav-item-label">{item.label}</div>
                                    <div className="nav-item-desc">{item.desc}</div>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Content Area */}
                <div className="settings-content">

                    {activeTab === 'general' && (
                        <GeneralSettings settings={settings} updateSettings={updateSettings} />
                    )}

                    {activeTab === 'sync' && (
                        <SyncSettings settings={settings} updateSettings={updateSettings} />
                    )}

                    {activeTab === 'appearance' && (
                        <AppearanceSettings settings={settings} updateSettings={updateSettings} />
                    )}

                    {activeTab === 'email' && (
                        <SMTPSettings settings={settings} />
                    )}

                    {activeTab === 'ai' && (
                        <AISettings settings={settings} updateSettings={updateSettings} />
                    )}

                    {activeTab === 'chat' && (
                        <ChatSettings />
                    )}

                    {/* ... existing tabs ... */}

                    {activeTab === 'backup' && (
                        <BackupSettings />
                    )}

                    {activeTab === 'status' && (
                        <SystemStatus settings={settings} />
                    )}

                    {/* Auto Tagging (Feature Flagged) */}
                    {activeAccount?.features?.autoTagging && activeTab === 'general' && (
                        <div style={{ marginTop: '2rem' }}>
                            <AutoTagSettings />
                        </div>
                    )}

                    {activeTab === 'marketing' && activeAccount?.features?.adRevenueTracking && (
                        <MarketingSettings />
                    )}

                </div>
            </div >
        </div >
    );
};

export default Settings;
