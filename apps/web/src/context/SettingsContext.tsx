import React, { createContext, useContext, useState, useEffect } from 'react';
import { getSetting, saveSetting } from '../db/db';
import { useAccount } from './AccountContext';
import { toast } from 'sonner';
import axios from 'axios';

interface SettingsState {
    storeUrl: string;
    consumerKey: string;
    consumerSecret: string;
    authMethod: 'auto' | 'basic' | 'query_string';
    syncInterval: number;
    aiApiKey: string;
    aiModel: string;
    minProfitMargin: number;
    goldPrice: number;
    brandColor: string;
    accentColor: string;
    invoiceLayout: string | null;
    footerText: string;
    [key: string]: any;
}

const DEFAULT_SETTINGS: SettingsState = {
    storeUrl: '',
    consumerKey: '',
    consumerSecret: '',
    authMethod: 'auto',
    syncInterval: 0,
    aiApiKey: '',
    aiModel: 'google/gemini-2.0-flash-exp:free',
    minProfitMargin: 0,
    goldPrice: 0,
    brandColor: '#6366f1',
    accentColor: '#8b5cf6',
    invoiceLayout: null,
    footerText: ''
};

interface SettingsContextType {
    settings: SettingsState;
    updateSettings: (newSettings: Partial<SettingsState>) => Promise<void>;
    loading: boolean;
    isConfigured: boolean;
}

const SettingsContext = createContext<SettingsContextType | null>(null);

export const useSettings = () => {
    const context = useContext(SettingsContext);
    if (!context) throw new Error("useSettings must be used within SettingsProvider");
    return context;
};

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { activeAccount, loading: accountLoading } = useAccount();

    const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS);
    const [loading, setLoading] = useState(true);

    // 1. Load Settings (API First, Fallback to Dexie Migration)
    useEffect(() => {
        const loadSettings = async () => {
            if (!activeAccount) {
                setLoading(false);
                return;
            }

            setLoading(true);
            try {
                // Try fetching from API
                const { data: serverSettings } = await axios.get('/api/settings', { withCredentials: true });

                // If Server has settings, use them
                if (serverSettings && (serverSettings.storeUrl || serverSettings.brandColor)) {
                    setSettings(prev => ({ ...prev, ...serverSettings }));
                    setLoading(false);
                    return;
                }

                // If Server is empty, check Dexie (Migration)
                // This only runs if server returned generic/empty data
                console.info("Server settings empty, checking local migration...");
                const acctId = activeAccount.id;

                // Helper to bulk get
                const keys = Object.keys(DEFAULT_SETTINGS);
                const migratedSettings: any = {};

                // This manual fetch matches the old logic to ensure we catch everything
                for (const key of keys) {
                    const val = await getSetting(key, acctId);
                    if (val) migratedSettings[key] = val;
                }

                if (Object.keys(migratedSettings).length > 0) {
                    // We found local data! Migrate it to Server.
                    console.info("Migrating local settings to server...", migratedSettings);
                    await axios.post('/api/settings', migratedSettings, { withCredentials: true });
                    setSettings(prev => ({ ...prev, ...migratedSettings }));
                    toast.success("Settings migrated to server.");
                }

            } catch (err) {
                console.error("Failed to load settings:", err);
                // Fallback to Dexie read-only if offline? 
                // For now, keep defaults/empty to avoid conflicts, or maybe implement read-from-cache logic later.
            } finally {
                setLoading(false);
            }
        };

        if (!accountLoading) {
            loadSettings();
        }
    }, [activeAccount, accountLoading]);

    // Apply Theme
    useEffect(() => {
        if (!settings.brandColor) return;

        const hexToRgb = (hex: string) => {
            const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
            hex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
            const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : null;
        };

        document.documentElement.style.setProperty('--primary', settings.brandColor);
        const rgb = hexToRgb(settings.brandColor);
        if (rgb) {
            document.documentElement.style.setProperty('--primary-glow', `rgba(${rgb}, 0.5)`);
        }

        if (settings.accentColor) {
            document.documentElement.style.setProperty('--accent', settings.accentColor);
        }
    }, [settings.brandColor, settings.accentColor]);

    const updateSettings = async (newSettings: Partial<SettingsState>) => {
        if (!activeAccount) return;

        // Validation
        if (newSettings.minProfitMargin !== undefined) {
            const val = parseFloat(newSettings.minProfitMargin as any);
            if (isNaN(val) || val < 0 || val > 100) {
                toast.error("Profit margin must be between 0 and 100");
                return;
            }
        }
        if (newSettings.syncInterval !== undefined) {
            const val = parseInt(newSettings.syncInterval as any);
            if (isNaN(val) || val < 0) {
                toast.error("Sync interval must be positive");
                return;
            }
        }
        if (newSettings.storeUrl) {
            let url = newSettings.storeUrl.trim();
            // Auto-fix missing protocol
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                url = `https://${url}`;
            }
            newSettings.storeUrl = url;
        }

        // Optimistic Update
        setSettings(prev => ({ ...prev, ...newSettings }));

        try {
            // Update Server
            await axios.post('/api/settings', newSettings, { withCredentials: true });

            // Update Local Legacy (Dual Write for Safety/Offline?)
            // Rework says: "Hot Tier (Local/Dexie)". 
            // So we should probably keep syncing to Dexie for offline read?
            // "Hot data" usually refers to orders. Settings are cold.
            // But let's keep Dexie updated just in case older components read `getSetting` directly.
            for (const [key, value] of Object.entries(newSettings)) {
                await saveSetting(key, value, activeAccount.id);
            }

            toast.success("Settings saved");
        } catch (err) {
            console.error("Failed to save settings to server:", err);
            toast.error("Failed to save settings to server");
            // Revert?
        }
    };

    const isConfigured = Boolean(settings.storeUrl && settings.consumerKey && settings.consumerSecret);

    return (
        <SettingsContext.Provider value={{ settings, updateSettings, loading: loading || accountLoading, isConfigured }}>
            {children}
        </SettingsContext.Provider>
    );
};
