
import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { Save, Loader2 } from 'lucide-react';
import { InboxRichTextEditor } from './InboxRichTextEditor';

export function ChatSettings() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [isLoading, setIsLoading] = useState(false);

    // Default config
    const [config, setConfig] = useState({
        position: 'bottom-right',
        showOnMobile: true,
        autoReply: {
            enabled: false,
            message: "Thanks for your message! We'll get back to you shortly."
        },
        businessHours: {
            enabled: false,
            // ... (rest of business hours unchanged)
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
                console.error(e);
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
            <div>
                <h3 className="text-lg font-medium text-gray-900 mb-4">Widget Appearance</h3>
                <div className="grid gap-6 md:grid-cols-2">
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
                        <div className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg border border-gray-100">
                            <input
                                type="checkbox"
                                checked={config.showOnMobile ?? true}
                                onChange={e => setConfig({ ...config, showOnMobile: e.target.checked })}
                                className="w-5 h-5 text-blue-600 rounded-sm focus:ring-blue-500"
                            />
                            <span className="text-sm text-gray-600">Show on Mobile Devices</span>
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
