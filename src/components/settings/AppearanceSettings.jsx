import React, { useState, useEffect } from 'react';
import { Check, Palette, Moon, Sun } from 'lucide-react';
import { toast } from 'sonner';

const PRESET_COLORS = [
    { name: 'Indigo (Default)', primary: '#6366f1', accent: '#8b5cf6' },
    { name: 'Emerald', primary: '#10b981', accent: '#3b82f6' },
    { name: 'Rose', primary: '#f43f5e', accent: '#a855f7' },
    { name: 'Amber', primary: '#f59e0b', accent: '#ef4444' },
    { name: 'Cyan', primary: '#06b6d4', accent: '#3b82f6' },
    { name: 'Midnight', primary: '#3b82f6', accent: '#6366f1' },
];

const AppearanceSettings = ({ settings, updateSettings }) => {
    const [themeColors, setThemeColors] = useState({
        brandColor: '#6366f1',
        accentColor: '#8b5cf6'
    });

    useEffect(() => {
        setThemeColors({
            brandColor: settings.brandColor || '#6366f1',
            accentColor: settings.accentColor || '#8b5cf6'
        });
    }, [settings]);

    const handleColorChange = (key, value) => {
        setThemeColors(prev => ({ ...prev, [key]: value }));
    };

    const applyPreset = (preset) => {
        setThemeColors({
            brandColor: preset.primary,
            accentColor: preset.accent
        });
        updateSettings({
            brandColor: preset.primary,
            accentColor: preset.accent
        });
        toast.success(`Theme set to ${preset.name}`);
    };

    const handleSave = async () => {
        await updateSettings(themeColors);
        toast.success('Appearance settings saved');
    };

    return (
        <div className="fade-in">
            <h2 className="section-title mb-6">Visual Customization</h2>

            <div className="form-group mb-8">
                <label className="form-label mb-4">Color Theme</label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {PRESET_COLORS.map(preset => (
                        <button
                            key={preset.name}
                            onClick={() => applyPreset(preset)}
                            className="p-4 rounded-lg border transition-all flex flex-col gap-2 relative overflow-hidden group"
                            style={{
                                borderColor: themeColors.brandColor === preset.primary ? 'var(--primary)' : 'var(--border-glass)',
                                background: 'rgba(255,255,255,0.02)'
                            }}
                        >
                            <div className="flex gap-2 mb-2">
                                <div className="w-8 h-8 rounded-full" style={{ background: preset.primary }}></div>
                                <div className="w-8 h-8 rounded-full" style={{ background: preset.accent }}></div>
                            </div>
                            <span className="text-sm font-medium text-main">{preset.name}</span>

                            {themeColors.brandColor === preset.primary && (
                                <div className="absolute top-2 right-2 text-primary">
                                    <Check size={16} />
                                </div>
                            )}
                        </button>
                    ))}
                </div>
            </div>

            <div className="form-group">
                <label className="form-label">Custom Colors</label>
                <div className="flex gap-6 flex-wrap">
                    <div>
                        <label className="text-xs text-muted block mb-2">Primary Brand Color</label>
                        <div className="flex items-center gap-3">
                            <input
                                type="color"
                                value={themeColors.brandColor}
                                onChange={(e) => handleColorChange('brandColor', e.target.value)}
                                className="w-12 h-12 rounded cursor-pointer border-0 p-0 overflow-hidden"
                            />
                            <div className="flex flex-col">
                                <span className="font-mono text-sm">{themeColors.brandColor}</span>
                                <span className="text-xs text-muted">Used for headers, buttons, accents</span>
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="text-xs text-muted block mb-2">Secondary Accent</label>
                        <div className="flex items-center gap-3">
                            <input
                                type="color"
                                value={themeColors.accentColor}
                                onChange={(e) => handleColorChange('accentColor', e.target.value)}
                                className="w-12 h-12 rounded cursor-pointer border-0 p-0 overflow-hidden"
                            />
                            <div className="flex flex-col">
                                <span className="font-mono text-sm">{themeColors.accentColor}</span>
                                <span className="text-xs text-muted">Used for gradients, highlights</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="form-actions mt-8 pt-6 border-t border-white/5">
                <button onClick={handleSave} className="btn btn-primary">
                    <Palette size={16} /> Save Custom Colors
                </button>
            </div>

            <p className="mt-4 text-xs text-muted opacity-60">
                Note: Color changes apply immediately to your dashboard, invoices, and email templates.
            </p>
        </div>
    );
};

export default AppearanceSettings;
