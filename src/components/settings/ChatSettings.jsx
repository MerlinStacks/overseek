import React, { useState, useEffect } from 'react';
import { Save, Clock, MessageSquare, Palette, Layout, Moon, Sun, Check, X, EyeOff, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useSettings } from '../../context/SettingsContext';
import { fetchChatSettings, saveChatSettings } from '../../services/api';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const ChatSettings = () => {
    const { settings, updateSettings } = useSettings();
    const [isSaving, setIsSaving] = useState(false);

    // Default State
    const [formData, setFormData] = useState({
        chatEnabled: true,
        offlineBehavior: 'hide', // 'hide' | 'message'
        offlineMessage: 'We are currently closed. Please leave a message or try again later.',
        primaryColor: '#6366f1',
        position: 'right', // 'left' | 'right'
        businessHours: DAYS.reduce((acc, day) => ({
            ...acc,
            [day]: { enabled: true, start: '09:00', end: '17:00' }
        }), {})
    });

    // Preview State (independent of saved settings)
    const [previewMode, setPreviewMode] = useState('online'); // 'online' | 'offline'

    useEffect(() => {
        if (!settings.storeUrl) return;
        const load = async () => {
            try {
                const data = await fetchChatSettings(settings);
                if (data && data.businessHours) {
                    setFormData(prev => ({
                        ...prev,
                        ...data,
                        businessHours: {
                            ...prev.businessHours,
                            ...data.businessHours
                        }
                    }));
                }
            } catch (e) {
                console.error("Failed to load Chat Settings", e);
            }
        };
        load();
    }, [settings]);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            await saveChatSettings(settings, formData);
            // Also update local context if needed, but primary is backend
            await updateSettings({
                ...settings,
                chatConfig: formData
            });
            toast.success("Chat settings saved successfully!");
        } catch (error) {
            console.error(error);
            toast.error("Failed to save settings.");
        } finally {
            setIsSaving(false);
        }
    };

    const handleDayToggle = (day) => {
        setFormData(prev => ({
            ...prev,
            businessHours: {
                ...prev.businessHours,
                [day]: {
                    ...prev.businessHours[day],
                    enabled: !prev.businessHours[day].enabled
                }
            }
        }));
    };

    const handleTimeChange = (day, field, value) => {
        setFormData(prev => ({
            ...prev,
            businessHours: {
                ...prev.businessHours,
                [day]: {
                    ...prev.businessHours[day],
                    [field]: value
                }
            }
        }));
    };

    // --- Preview Component ---
    const ChatPreview = () => (
        <div className="glass-panel" style={{ position: 'sticky', top: '2rem', minHeight: '500px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#e2e8f0', backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)', backgroundSize: '20px 20px' }}>
            <h3 style={{ marginBottom: '2rem', color: '#475569', fontWeight: 600 }}>Live Preview</h3>

            <div style={{
                width: '300px',
                height: '400px',
                background: '#fff',
                borderRadius: '12px',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                position: 'relative',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column'
            }}>
                {/* Simulated Website Header */}
                <div style={{ height: '40px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', padding: '0 12px' }}>
                    <div style={{ width: '80px', height: '8px', background: '#cbd5e1', borderRadius: '4px' }}></div>
                </div>
                {/* Content Area */}
                <div style={{ flex: 1, padding: '20px' }}>
                    <div style={{ width: '100%', height: '8px', background: '#f1f5f9', borderRadius: '4px', marginBottom: '10px' }}></div>
                    <div style={{ width: '70%', height: '8px', background: '#f1f5f9', borderRadius: '4px', marginBottom: '10px' }}></div>
                    <div style={{ width: '80%', height: '8px', background: '#f1f5f9', borderRadius: '4px', marginBottom: '10px' }}></div>
                </div>

                {/* Chat Widget */}
                {/* Online State or Offline Message Mode */}
                {((previewMode === 'online') || (previewMode === 'offline' && formData.offlineBehavior === 'message')) && (
                    <div style={{
                        position: 'absolute',
                        bottom: '20px',
                        [formData.position]: '20px',
                        transition: 'all 0.3s ease'
                    }}>
                        {/* Chat Bubble trigger */}
                        <div style={{
                            width: '56px',
                            height: '56px',
                            borderRadius: '50%',
                            background: formData.primaryColor,
                            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#fff',
                            cursor: 'pointer'
                        }}>
                            <MessageCircle size={28} />
                        </div>
                    </div>
                )}
            </div>

            <div style={{ marginTop: '1.5rem', display: 'flex', gap: '10px', background: 'white', padding: '4px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <button
                    onClick={() => setPreviewMode('online')}
                    className={`btn btn-sm ${previewMode === 'online' ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ fontSize: '0.8rem' }}
                >
                    <Sun size={14} style={{ marginRight: '4px' }} /> Online
                </button>
                <button
                    onClick={() => setPreviewMode('offline')}
                    className={`btn btn-sm ${previewMode === 'offline' ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ fontSize: '0.8rem' }}
                >
                    <Moon size={14} style={{ marginRight: '4px' }} /> Offline
                </button>
            </div>

            {previewMode === 'offline' && formData.offlineBehavior === 'hide' && (
                <p style={{ marginTop: '1rem', color: '#64748b', fontSize: '0.9rem' }}>
                    <EyeOff size={14} style={{ display: 'inline', marginRight: '4px', verticalAlign: '-2px' }} />
                    Widget is hidden when offline
                </p>
            )}
        </div>
    );

    return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '2rem' }}>
            <div className="space-y-6">

                {/* Header */}
                <div className="settings-content-header">
                    <h2 className="settings-title">Live Chat Configuration</h2>
                    <p className="settings-subtitle">Manage availability, styling, and offline behavior for your storefront chat.</p>
                </div>

                {/* Enable / Disable */}
                <div className="glass-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.25rem' }}>Enable Live Chat</h3>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Turn the chat widget on or off globally.</p>
                        </div>
                        <label className="toggle-switch">
                            <input
                                type="checkbox"
                                checked={formData.chatEnabled}
                                onChange={(e) => setFormData({ ...formData, chatEnabled: e.target.checked })}
                            />
                            <span className="slider round"></span>
                        </label>
                    </div>
                </div>

                {/* Appearance */}
                <div className="glass-card">
                    <div className="settings-content-header" style={{ marginBottom: '1.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <Palette size={20} className="text-secondary" />
                            <h3 className="section-label" style={{ fontSize: '1.1rem', margin: 0 }}>Visual Designer</h3>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="form-label">Primary Color</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <input
                                    type="color"
                                    value={formData.primaryColor}
                                    onChange={(e) => setFormData({ ...formData, primaryColor: e.target.value })}
                                    style={{ width: '40px', height: '40px', padding: 0, border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                                />
                                <span style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>{formData.primaryColor}</span>
                            </div>
                        </div>
                        <div>
                            <label className="form-label">Position</label>
                            <div className="btn-group">
                                <button
                                    className={`btn ${formData.position === 'left' ? 'btn-secondary' : 'btn-ghost'}`}
                                    onClick={() => setFormData({ ...formData, position: 'left' })}
                                >
                                    Bottom Left
                                </button>
                                <button
                                    className={`btn ${formData.position === 'right' ? 'btn-secondary' : 'btn-ghost'}`}
                                    onClick={() => setFormData({ ...formData, position: 'right' })}
                                >
                                    Bottom Right
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Offline Behavior */}
                <div className="glass-card">
                    <div className="settings-content-header" style={{ marginBottom: '1.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <Moon size={20} className="text-warning" />
                            <h3 className="section-label" style={{ fontSize: '1.1rem', margin: 0 }}>Offline Behavior</h3>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="form-label">When Offline...</label>
                            <select
                                className="input-field"
                                value={formData.offlineBehavior}
                                onChange={(e) => setFormData({ ...formData, offlineBehavior: e.target.value })}
                            >
                                <option value="hide">Hide Chat Widget</option>
                                <option value="message">Show Offline Message</option>
                            </select>
                        </div>

                        {formData.offlineBehavior === 'message' && (
                            <div className="animate-fade-in">
                                <label className="form-label">Offline Message</label>
                                <textarea
                                    className="input-field"
                                    rows={3}
                                    value={formData.offlineMessage}
                                    onChange={(e) => setFormData({ ...formData, offlineMessage: e.target.value })}
                                />
                            </div>
                        )}
                    </div>
                </div>

                {/* Business Hours */}
                <div className="glass-card">
                    <div className="settings-content-header" style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <Clock size={20} className="text-success" />
                            <div>
                                <h3 className="section-label" style={{ fontSize: '1.1rem', margin: 0 }}>Business Hours</h3>
                                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                                    Your store time zone: <strong>{settings.timeZone || 'System Default'}</strong>
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-3">
                        {DAYS.map(day => {
                            const dayConfig = formData.businessHours[day];
                            return (
                                <div key={day} style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '1rem',
                                    padding: '0.75rem',
                                    background: 'rgba(255,255,255,0.03)',
                                    borderRadius: '8px',
                                    border: '1px solid rgba(255,255,255,0.05)'
                                }}>
                                    <div style={{ width: '120px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <label className="toggle-switch sm">
                                            <input
                                                type="checkbox"
                                                checked={dayConfig.enabled}
                                                onChange={() => handleDayToggle(day)}
                                            />
                                            <span className="slider round"></span>
                                        </label>
                                        <span style={{ fontWeight: 500, color: dayConfig.enabled ? 'var(--text-main)' : 'var(--text-muted)' }}>{day}</span>
                                    </div>

                                    {dayConfig.enabled ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
                                            <input
                                                type="time"
                                                className="input-field sm"
                                                value={dayConfig.start}
                                                onChange={(e) => handleTimeChange(day, 'start', e.target.value)}
                                            />
                                            <span style={{ color: 'var(--text-muted)' }}>to</span>
                                            <input
                                                type="time"
                                                className="input-field sm"
                                                value={dayConfig.end}
                                                onChange={(e) => handleTimeChange(day, 'end', e.target.value)}
                                            />
                                        </div>
                                    ) : (
                                        <div style={{ flex: 1, color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.9rem' }}>
                                            Closed
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '1rem' }}>
                    <button
                        className="btn btn-primary"
                        onClick={handleSave}
                        disabled={isSaving}
                        style={{ padding: '0.75rem 2rem', fontSize: '1rem' }}
                    >
                        {isSaving ? (
                            <>
                                <div className="spinner-sm" style={{ marginRight: '8px' }}></div>
                                Saving...
                            </>
                        ) : (
                            <>
                                <Save size={18} style={{ marginRight: '8px' }} />
                                Save Configuration
                            </>
                        )}
                    </button>
                </div>

            </div>

            {/* Sidebar Preview */}
            <ChatPreview />
        </div>
    );
};

export default ChatSettings;
