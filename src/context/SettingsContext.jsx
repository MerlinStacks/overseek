import React, { createContext, useContext, useState, useEffect } from 'react';
import { getSetting, saveSetting } from '../db/db';
import { useAccount } from './AccountContext';
import { toast } from 'sonner';

const SettingsContext = createContext();

// eslint-disable-next-line react-refresh/only-export-components
export const useSettings = () => useContext(SettingsContext);

 
export const SettingsProvider = ({ children }) => {
    const { activeAccount, loading: accountLoading } = useAccount();

    const [settings, setSettings] = useState({
        storeUrl: '',
        consumerKey: '',
        consumerSecret: '',
        authMethod: 'auto',
        syncInterval: 0, // 0 means off
        aiApiKey: '',
        aiModel: 'google/gemini-2.0-flash-exp:free',
        minProfitMargin: 0,
        goldPrice: 0,
        brandColor: '#6366f1',
        accentColor: '#8b5cf6'
    });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadSettings = async () => {
            if (!activeAccount) {
                // If accounts are loaded but none selected (no accounts?), we can't load settings.
                setLoading(false);
                return;
            }

            setLoading(true);
            const acctId = activeAccount.id;

            const storeUrl = await getSetting('storeUrl', acctId) || '';
            const consumerKey = await getSetting('consumerKey', acctId) || '';
            const consumerSecret = await getSetting('consumerSecret', acctId) || '';
            const authMethod = await getSetting('authMethod', acctId) || 'auto';
            const syncInterval = parseInt(await getSetting('syncInterval', acctId) || '0', 10);
            const aiApiKey = await getSetting('aiApiKey', acctId) || '';
            const aiModel = await getSetting('aiModel', acctId) || 'google/gemini-2.0-flash-exp:free';
            const minProfitMargin = parseFloat(await getSetting('minProfitMargin', acctId) || '0');
            const goldPrice = parseFloat(await getSetting('goldPrice', acctId) || '0');
            const brandColor = await getSetting('brandColor', acctId) || '#6366f1';
            const accentColor = await getSetting('accentColor', acctId) || '#8b5cf6';
            const invoiceLayout = await getSetting('invoiceLayout', acctId) || null;
            const footerText = await getSetting('footerText', acctId) || '';

            setSettings({ storeUrl, consumerKey, consumerSecret, authMethod, syncInterval, aiApiKey, aiModel, minProfitMargin, goldPrice, brandColor, accentColor, invoiceLayout, footerText });
            setLoading(false);
        };

        if (!accountLoading) {
            loadSettings();
        }
    }, [activeAccount, accountLoading]);

    // Apply Theme
    useEffect(() => {
        if (!settings.brandColor) return;

        const hexToRgb = (hex) => {
            const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
            hex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
            const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : null;
        };

        // Primary
        document.documentElement.style.setProperty('--primary', settings.brandColor);
        const rgb = hexToRgb(settings.brandColor);
        if (rgb) {
            document.documentElement.style.setProperty('--primary-glow', `rgba(${rgb}, 0.5)`);
        }

        // Accent
        if (settings.accentColor) {
            document.documentElement.style.setProperty('--accent', settings.accentColor);
        }
    }, [settings.brandColor, settings.accentColor]);

    const updateSettings = async (newSettings) => {
        if (!activeAccount) return;

        // Validation
        if (newSettings.minProfitMargin !== undefined) {
            const val = parseFloat(newSettings.minProfitMargin);
            if (isNaN(val) || val < 0 || val > 100) {
                toast.error("Profit margin must be between 0 and 100");
                return;
            }
        }
        if (newSettings.syncInterval !== undefined) {
            const val = parseInt(newSettings.syncInterval);
            if (isNaN(val) || val < 0) {
                toast.error("Sync interval must be positive");
                return;
            }
        }
        if (newSettings.storeUrl) {
            if (!newSettings.storeUrl.startsWith('http')) {
                toast.error("Store URL must start with http:// or https://");
                return;
            }
        }

        // Update state
        setSettings(prev => ({ ...prev, ...newSettings }));

        // Update DB
        for (const [key, value] of Object.entries(newSettings)) {
            await saveSetting(key, value, activeAccount.id);
        }
    };

    const isConfigured = Boolean(settings.storeUrl && settings.consumerKey && settings.consumerSecret);

    return (
        <SettingsContext.Provider value={{ settings, updateSettings, loading: loading || accountLoading, isConfigured }}>
            {children}
        </SettingsContext.Provider>
    );
};
