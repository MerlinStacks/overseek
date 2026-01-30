
import { useState, useEffect } from 'react';
import { Logger } from '../../utils/logger';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { Save, Loader2, MessageSquare } from 'lucide-react';
import { InboxRichTextEditor } from './InboxRichTextEditor';

/**
 * Adjusts hex color brightness for gradient generation.
 * @param hex - Hex color string (e.g., '#2563eb')
 * @param amount - Amount to adjust (-30 for darker, +30 for lighter)
 */
function adjustColor(hex: string, amount: number): string {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return hex;
    const r = Math.max(0, Math.min(255, parseInt(result[1], 16) + amount));
    const g = Math.max(0, Math.min(255, parseInt(result[2], 16) + amount));
    const b = Math.max(0, Math.min(255, parseInt(result[3], 16) + amount));
    return `rgb(${r}, ${g}, ${b})`;
}

/**
 * ChatSettings - Manages live chat widget configuration including appearance customization.
 * Settings are stored in AccountFeature with key 'CHAT_SETTINGS'.
 */
export function ChatSettings() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [isLoading, setIsLoading] = useState(false);

    // Default config with new appearance settings
    const [config, setConfig] = useState({
        enabled: true,
        position: 'bottom-right',
        showOnMobile: true,
        primaryColor: '#2563eb',
        headerText: 'Live Chat',
        welcomeMessage: 'Hello! How can we help you today?',
        autoReply: {
            enabled: false,
            message: "Thanks for your message! We'll get back to you shortly."
        },
        businessHours: {
            enabled: false,
            days: {
                mon: { open: '09:00', close: '17:00', isOpen: true },
                tue: { open: '09:00', close: '17:00', isOpen: true },
                wed: { open: '09:00', close: '17:00', isOpen: true },
                thu: { open: '09:00', close: '17:00', isOpen: true },
                fri: { open: '09:00', close: '17:00', isOpen: true },
                sat: { open: '10:00', close: '14:00', isOpen: false },
                sun: { open: '10:00', close: '14:00', isOpen: false },
            },
            offlineMessage: "We are currently closed. We will reply when we return."
        }
    });

    useEffect(() => {
        if (!currentAccount) return;
        const fetchSettings = async () => {
            try {
                const res = await fetch('/api/chat/settings', {
                    headers: { 'Authorization': `Bearer ${token}`, 'x-account-id': currentAccount.id }
                });
                const data = await res.json();
                if (data && Object.keys(data).length > 0) {
                    setConfig(prev => ({ ...prev, ...data }));
                }
            } catch (e) {
                Logger.error('An error occurred', { error: e });
            }
        };
        fetchSettings();
    }, [currentAccount, token]);

    const handleSave = async () => {
        setIsLoading(true);
        try {
            await fetch('/api/chat/settings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount!.id
                },
                body: JSON.stringify(config)
            });
            alert('Saved');
        } catch (e) {
            alert('Failed');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-8">
            {/* Widget Appearance with Live Preview */}
            <div>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-medium text-gray-900">Widget Appearance</h3>
                    <div className="flex items-center gap-3">
                        <label className="text-sm font-medium text-gray-700">Enable Live Chat Widget</label>
                        <button
                            type="button"
                            onClick={() => setConfig({ ...config, enabled: config.enabled === false })}
                            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${config.enabled !== false ? 'bg-blue-600' : 'bg-gray-200'}`}
                            role="switch"
                            aria-checked={config.enabled !== false}
                        >
                            <span
                                aria-hidden="true"
                                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${config.enabled !== false ? 'translate-x-5' : 'translate-x-0'}`}
                            />
                        </button>
                    </div>
                </div>

                <div className={`grid gap-6 lg:grid-cols-2 ${config.enabled === false ? 'opacity-50 pointer-events-none' : ''}`}>
                    {/* Settings Column */}
                    <div className="space-y-5">
                        {/* Primary Color */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Primary Color</label>
                            <div className="flex items-center gap-3">
                                <input
                                    type="color"
                                    value={config.primaryColor || '#2563eb'}
                                    onChange={e => setConfig({ ...config, primaryColor: e.target.value })}
                                    className="h-10 w-16 p-1 border border-gray-300 rounded cursor-pointer"
                                />
                                <input
                                    type="text"
                                    value={config.primaryColor || '#2563eb'}
                                    onChange={e => setConfig({ ...config, primaryColor: e.target.value })}
                                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-hidden font-mono uppercase text-sm"
                                    placeholder="#2563eb"
                                />
                            </div>
                            <p className="text-xs text-gray-500 mt-1">Used for the button, header, and user messages.</p>
                        </div>

                        {/* Header Text */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Header Text</label>
                            <input
                                type="text"
                                value={config.headerText || 'Live Chat'}
                                onChange={e => setConfig({ ...config, headerText: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-hidden"
                                placeholder="Live Chat"
                                maxLength={30}
                            />
                            <p className="text-xs text-gray-500 mt-1">Displayed at the top of the chat window.</p>
                        </div>

                        {/* Welcome Message */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Welcome Message</label>
                            <textarea
                                value={config.welcomeMessage || 'Hello! How can we help you today?'}
                                onChange={e => setConfig({ ...config, welcomeMessage: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-hidden resize-none"
                                placeholder="Hello! How can we help you today?"
                                rows={2}
                                maxLength={200}
                            />
                            <p className="text-xs text-gray-500 mt-1">First message visitors see when opening the widget.</p>
                        </div>

                        {/* Position & Mobile */}
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Position</label>
                                <select
                                    value={config.position || 'bottom-right'}
                                    onChange={e => setConfig({ ...config, position: e.target.value })}
                                    className="w-full border rounded-lg px-3 py-2 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-hidden transition-all"
                                >
                                    <option value="bottom-right">Bottom Right</option>
                                    <option value="bottom-left">Bottom Left</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Mobile Visibility</label>
                                <div className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg border border-gray-100 h-[42px]">
                                    <input
                                        type="checkbox"
                                        checked={config.showOnMobile ?? true}
                                        onChange={e => setConfig({ ...config, showOnMobile: e.target.checked })}
                                        className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                                    />
                                    <span className="text-sm text-gray-600">Show on Mobile</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Live Preview Column - 2026 Modern Design */}
                    <div className="flex flex-col">
                        <label className="block text-sm font-medium text-gray-700 mb-2">Live Preview</label>
                        <div className="flex-1 bg-gradient-to-br from-slate-100 to-slate-200 rounded-xl p-4 relative min-h-[400px] flex items-end justify-end">
                            {/* Mini Widget Preview */}
                            <div className="w-[300px]">
                                {/* Chat Window - Glassmorphism */}
                                <div className="bg-white/95 backdrop-blur-xl rounded-[20px] shadow-2xl overflow-hidden border border-white/20 mb-3">
                                    {/* Header - Gradient */}
                                    <div
                                        className="px-5 py-4 text-white flex justify-between items-center relative overflow-hidden"
                                        style={{
                                            background: `linear-gradient(135deg, ${config.primaryColor || '#2563eb'}, ${adjustColor(config.primaryColor || '#2563eb', -30)})`
                                        }}
                                    >
                                        <div className="absolute inset-0 bg-gradient-to-r from-white/10 to-transparent" />
                                        <span className="font-semibold text-[15px] flex items-center gap-2.5 relative z-10">
                                            <span className="w-2.5 h-2.5 bg-green-400 rounded-full shadow-[0_0_8px_#22c55e] animate-pulse" />
                                            {config.headerText || 'Live Chat'}
                                        </span>
                                        <span className="text-white/80 text-xl cursor-pointer hover:text-white relative z-10 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors">×</span>
                                    </div>
                                    {/* Messages */}
                                    <div className="p-4 bg-slate-50 min-h-[130px] space-y-3">
                                        <div className="bg-white border border-slate-200 rounded-[18px] rounded-bl-sm px-4 py-3 text-sm text-slate-700 max-w-[88%] shadow-sm">
                                            {config.welcomeMessage || 'Hello! How can we help you today?'}
                                        </div>
                                        {/* Typing Indicator */}
                                        <div className="bg-white border border-slate-200 rounded-[18px] rounded-bl-sm px-4 py-3 max-w-[60px] flex gap-1">
                                            <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                            <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                            <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                                        </div>
                                    </div>
                                    {/* Input Area */}
                                    <div className="px-4 py-3 border-t border-slate-200 flex gap-3 bg-white">
                                        <input
                                            type="text"
                                            placeholder="Type a message..."
                                            className="flex-1 border-2 border-slate-200 rounded-full px-4 py-2.5 text-sm bg-slate-50"
                                            disabled
                                        />
                                        <button
                                            className="w-11 h-11 rounded-full text-white flex items-center justify-center shadow-lg"
                                            style={{
                                                background: `linear-gradient(135deg, ${config.primaryColor || '#2563eb'}, ${adjustColor(config.primaryColor || '#2563eb', -30)})`
                                            }}
                                            disabled
                                        >
                                            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <line x1="22" y1="2" x2="11" y2="13" />
                                                <polygon points="22 2 15 22 11 13 2 9 22 2" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                                {/* Toggle Button */}
                                <div className="flex justify-end">
                                    <div
                                        className="w-16 h-16 rounded-full flex items-center justify-center shadow-2xl cursor-pointer transition-transform hover:scale-105 relative overflow-hidden"
                                        style={{
                                            background: `linear-gradient(135deg, ${config.primaryColor || '#2563eb'}, ${adjustColor(config.primaryColor || '#2563eb', -30)})`
                                        }}
                                    >
                                        <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent" />
                                        <MessageSquare size={28} className="text-white relative z-10" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="border-t pt-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Auto-Reply</h3>
                <div className="flex items-center gap-4 mb-4">
                    <input
                        type="checkbox"
                        checked={config.autoReply.enabled}
                        onChange={e => setConfig({ ...config, autoReply: { ...config.autoReply, enabled: e.target.checked } })}
                        className="w-4 h-4"
                    />
                    <label>Enable standardized auto-reply to new conversations</label>
                </div>
                {config.autoReply.enabled && (
                    <textarea
                        value={config.autoReply.message}
                        onChange={e => setConfig({ ...config, autoReply: { ...config.autoReply, message: e.target.value } })}
                        className="w-full border rounded-sm p-2"
                        rows={3}
                    />
                )}
            </div>

            <div className="border-t pt-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Business Hours</h3>
                <div className="flex items-center gap-4 mb-4">
                    <input
                        type="checkbox"
                        checked={config.businessHours.enabled}
                        onChange={e => setConfig({ ...config, businessHours: { ...config.businessHours, enabled: e.target.checked } })}
                        className="w-4 h-4"
                    />
                    <label>Enable business hours (Offline message sent outside hours)</label>
                </div>

                {config.businessHours.enabled && (
                    <div className="space-y-4">
                        <div className="grid gap-2">
                            {/* Simplified Day Editor */}
                            {Object.entries(config.businessHours.days).map(([day, schedule]: [string, any]) => (
                                <div key={day} className="flex items-center gap-4">
                                    <span className="w-12 uppercase text-xs font-bold">{day}</span>
                                    <input
                                        type="checkbox"
                                        checked={schedule.isOpen}
                                        onChange={e => {
                                            const newDays = { ...config.businessHours.days };
                                            (newDays as any)[day].isOpen = e.target.checked;
                                            setConfig({ ...config, businessHours: { ...config.businessHours, days: newDays } });
                                        }}
                                    />
                                    {schedule.isOpen ? (
                                        <>
                                            <input type="time" value={schedule.open} onChange={e => {
                                                const newDays = { ...config.businessHours.days };
                                                (newDays as any)[day].open = e.target.value;
                                                setConfig({ ...config, businessHours: { ...config.businessHours, days: newDays } });
                                            }} className="border rounded-sm px-2" />
                                            <span>to</span>
                                            <input type="time" value={schedule.close} onChange={e => {
                                                const newDays = { ...config.businessHours.days };
                                                (newDays as any)[day].close = e.target.value;
                                                setConfig({ ...config, businessHours: { ...config.businessHours, days: newDays } });
                                            }} className="border rounded-sm px-2" />
                                        </>
                                    ) : (
                                        <span className="text-gray-400 italic">Closed</span>
                                    )}
                                </div>
                            ))}
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1">Offline Message</label>
                            <div className="border rounded-sm p-3 bg-white">
                                <InboxRichTextEditor
                                    value={config.businessHours.offlineMessage}
                                    onChange={(val) => setConfig({ ...config, businessHours: { ...config.businessHours, offlineMessage: val } })}
                                    placeholder="We are currently closed. We will reply when we return."
                                />
                            </div>
                            <p className="text-xs text-gray-500 mt-1">Supports bold, italic, links, and emojis</p>
                        </div>
                    </div>
                )}
            </div>

            <div className="flex justify-end pt-4">
                <button
                    onClick={handleSave}
                    disabled={isLoading}
                    className="bg-blue-600 text-white px-4 py-2 rounded-sm flex items-center gap-2"
                >
                    {isLoading ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                    Save Settings
                </button>
            </div>
        </div>
    );
}
