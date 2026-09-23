import { Package } from 'lucide-react';
import type { SettingsFieldsProps } from './types';

/** A presentation-only sample avoids implying that a date calculator is live. */
export function BrandingSettings({ settings, onChange }: SettingsFieldsProps) {
    const branding = settings.branding;
    const update = (patch: Partial<typeof branding>) => onChange({ ...settings, branding: { ...branding, ...patch } });
    return <section className="space-y-4">
        <h3 className="text-lg font-semibold">Compact storefront branding</h3>
        <div className="grid gap-4 sm:grid-cols-3">
            {(['textColor', 'accentColor', 'backgroundColor'] as const).map(key => <div key={key}>
                <label>{key === 'textColor' ? 'Text colour' : key === 'accentColor' ? 'Accent colour' : 'Background colour'}
                    <input type="color" value={branding[key] ?? '#ffffff'} onChange={e => update({ [key]: e.target.value })} /></label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={branding[key] === null}
                    onChange={e => update({ [key]: e.target.checked ? null : '#ffffff' })} />Inherit theme</label>
            </div>)}
            <label>Text size (px)<input type="number" required min={12} max={20} step={1} value={Number.isNaN(branding.fontSize) ? '' : branding.fontSize}
                onChange={e => update({ fontSize: e.target.valueAsNumber })} /></label>
            <label>Spacing<select value={branding.spacing} onChange={e => update({ spacing: e.target.value as typeof branding.spacing })}>
                <option value="compact">Compact</option><option value="comfortable">Comfortable</option>
            </select></label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={branding.showIcon} onChange={e => update({ showIcon: e.target.checked })} />Small icon</label>
        </div>
        <button type="button" onClick={() => update({ textColor: null, accentColor: null, backgroundColor: null, fontSize: 14, spacing: 'compact', showIcon: false })}>Reset branding to theme defaults</button>
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-3">
            <p className="text-sm font-medium">Style preview — sample wording and dates, not calculated estimates</p>
            <div className="flex flex-wrap gap-4">{[false, true].map(mobile => <div key={String(mobile)} className={mobile ? 'w-64 max-w-full' : 'flex-1 min-w-0'}>
                <p className="text-xs mb-2">{mobile ? 'Narrow' : 'Wide'} sample</p>
                <div className="break-words rounded" style={{ color: branding.textColor ?? undefined, backgroundColor: branding.backgroundColor ?? undefined,
                    fontSize: Number.isFinite(branding.fontSize) ? branding.fontSize : 14, padding: branding.spacing === 'compact' ? 4 : 8 }}>
                    {branding.showIcon && <Package aria-hidden="true" size={16} className="inline mr-1" style={{ color: branding.accentColor ?? undefined }} />}
                    Estimated delivery: <span style={{ color: branding.accentColor ?? undefined }}>12–16 October</span>
                    <div>Ready for collection: 12 October</div>
                </div>
            </div>)}</div>
        </div>
    </section>;
}
